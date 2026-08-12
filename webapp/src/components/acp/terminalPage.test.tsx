import {TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder} from 'util'

import {render, screen, waitFor} from '@solidjs/testing-library'
import {MemoryRouter, Route, createMemoryHistory} from '@solidjs/router'
import userEvent from '@testing-library/user-event'

import {IntlProvider} from '../../intl'
import '@testing-library/jest-dom'

import TerminalPage from './terminalPage'

// xterm draws into a real canvas and measures it, which jsdom cannot do. The
// emulator is not what this tests: the wiring is — which socket the page opens,
// what it tells the pty about its size, and what it does with what it reads.
const written: Uint8Array[] = []
const onDataHandlers: Array<(data: string) => void> = []

vi.mock('@xterm/xterm', () => ({
    Terminal: class {
        cols = 100
        rows = 30
        loadAddon() {}
        open() {}
        focus() {}
        dispose() {}
        write(data: Uint8Array) {
            written.push(data)
        }
        onData(handler: (data: string) => void) {
            onDataHandlers.push(handler)
        }
    },
}))
vi.mock('@xterm/addon-fit', () => ({
    FitAddon: class {
        fit() {}
    },
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}), {virtual: true})

class FakeSocket {
    static all: FakeSocket[] = []
    static readonly OPEN = 1
    url: string
    binaryType = ''
    readyState = 1
    sent: any[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: any) => void) | null = null
    onclose: (() => void) | null = null
    onerror: (() => void) | null = null

    constructor(url: string) {
        this.url = url
        FakeSocket.all.push(this)
    }
    send(data: any) {
        this.sent.push(data)
    }
    close() {
        this.readyState = 3
    }
}

const renderPage = () => {
    const history = createMemoryHistory()
    history.set({value: '/acp/terminal/term-1'})
    return render(() =>
        <IntlProvider
            locale='en'
            messages={{}}
        >
            <MemoryRouter history={history}>
                <Route
                    path='/acp/terminal/:terminalId'
                    component={TerminalPage}
                />
            </MemoryRouter>
        </IntlProvider>,
    )
}

// The page opens two sockets: the pty it draws, and the one shared connection
// every ACP component listens on — it reads the card's pending question from
// there. Only the first is this test's business.
const ptySocket = async (): Promise<FakeSocket> => {
    let found: FakeSocket | undefined
    await waitFor(() => {
        found = FakeSocket.all.find((s) => new URL(s.url).pathname.startsWith('/acp/terminal/'))
        expect(found).toBeDefined()
    })
    return found!
}

// jsdom ships without them; every browser and the webview have them.
if (typeof global.TextEncoder === 'undefined') {
    (global as any).TextEncoder = NodeTextEncoder
    ;(global as any).TextDecoder = NodeTextDecoder
}

describe('components/acp/terminalPage', () => {
    beforeEach(() => {
        written.length = 0
        onDataHandlers.length = 0
        FakeSocket.all = []
        ;(global as any).WebSocket = FakeSocket
        ;(global as any).ResizeObserver = class {
            observe() {}
            disconnect() {}
        }
        ;(window as any).go = {
            main: {
                App: {
                    GetTerminalInfo: vi.fn().mockResolvedValue(JSON.stringify({
                        id: 'term-1',
                        title: 'Фикс логина',
                        task: 'Почини логин',
                        cwd: '/tmp/wt/acp-fix-login',
                        branch: 'acp/fix-login-3f2a',
                        agent: 'clauuus',
                        kind: 'claude',
                        command: 'claude --continue',
                        running: true,
                        exitCode: 0,
                    })),
                },
            },
        }
    })

    afterEach(() => {
        delete (window as any).go
    })

    it('connects to its own terminal socket and reports the window size', async () => {
        renderPage()

        const socket = await ptySocket()

        // The exact path, not merely one containing it: this page lives at
        // /acp/terminal/<id>, and a relative address would resolve against that
        // directory into /acp/terminal/acp/terminal/<id>/ws.
        expect(new URL(socket.url).pathname).toBe('/acp/terminal/term-1/ws')
        expect(socket.url.startsWith('ws://')).toBe(true)

        socket.onopen!()

        // A pty that is not told its size wraps everything at 80 columns and
        // draws a TUI on top of itself.
        expect(JSON.parse(socket.sent[0])).toEqual({type: 'resize', cols: 100, rows: 30})
    })

    it('shows the session and writes what the CLI prints', async () => {
        renderPage()
        await waitFor(() => expect(screen.getByText('clauuus')).toBeInTheDocument())
        expect(screen.getByText('acp/fix-login-3f2a')).toBeInTheDocument()

        const socket = await ptySocket()
        socket.onopen!()
        socket.onmessage!({data: new TextEncoder().encode('hello from the CLI').buffer})
        expect(new TextDecoder().decode(written[0])).toBe('hello from the CLI')
    })

    it('sends keystrokes to the pty', async () => {
        renderPage()
        await waitFor(() => expect(onDataHandlers.length).toBe(1))
        const socket = await ptySocket()
        socket.onopen!()
        onDataHandlers[0]('ls\r')
        expect(new TextDecoder().decode(socket.sent[socket.sent.length - 1])).toBe('ls\r')
    })

    it('says when the CLI has exited rather than leaving a dead prompt', async () => {
        renderPage()
        const socket = await ptySocket()
        socket.onopen!()
        await waitFor(() => expect(screen.getByText('session running')).toBeInTheDocument())

        socket.onmessage!({data: '{"type":"exit"}'})
        await waitFor(() => expect(screen.getByText('the CLI has exited — this window can be closed')).toBeInTheDocument())
    })

    // The card draws the same page in the panel its chevron opens, where there
    // is no route to read the terminal from — so it hands one in, and the page
    // has to wire itself to that one rather than to the address bar.
    it('draws the terminal it was handed when there is no route to read', async () => {
        render(() =>
            <IntlProvider
                locale='en'
                messages={{}}
            >
                <MemoryRouter history={createMemoryHistory()}>
                    <Route
                        path='/'
                        component={() => <TerminalPage terminalId='term-42'/>}
                    />
                </MemoryRouter>
            </IntlProvider>,
        )

        expect(new URL((await ptySocket()).url).pathname).toBe('/acp/terminal/term-42/ws')
    })

    it('pastes the card task into the prompt on request', async () => {
        renderPage()
        await waitFor(() => expect(screen.getByText('Paste the task')).toBeInTheDocument())
        const socket = await ptySocket()
        socket.onopen!()
        screen.getByText('Paste the task').click()
        await waitFor(() => {
            const last = socket.sent[socket.sent.length - 1]
            expect(new TextDecoder().decode(last)).toBe('Почини логин')
        })
    })

    // The dot on the card opens this window, and the question it is amber for
    // was asked over the protocol rather than in the pty — so it can only be
    // shown around the terminal. Without it the dot would lead to a window with
    // nothing in it about what is being waited for.
    it('shows the question waiting on this terminal’s card and answers it', async () => {
        const answerQuestion = vi.fn().mockResolvedValue(undefined);
        (window as any).go.main.App.GetTerminalInfo = vi.fn().mockResolvedValue(JSON.stringify({
            id: 'term-1',
            cardId: 'card-9',
            cwd: '/tmp/wt/acp-fix-login',
            agent: 'clauuus',
            kind: 'claude',
            command: 'claude --continue',
            running: true,
            exitCode: 0,
        }));
        (window as any).go.main.App.ListAttention = vi.fn().mockResolvedValue(JSON.stringify([{
            key: 'q:7',
            cardId: 'card-9',
            questionId: 'q-7',
            agent: 'clauuus',
            reason: 'question',
            text: 'Снести ветку или оставить?',
            options: [{id: 'keep', label: 'Оставить'}],
            awaiting: true,
        }]));
        (window as any).go.main.App.AnswerQuestion = answerQuestion

        renderPage()

        await userEvent.click(await screen.findByText('Оставить'))
        expect(answerQuestion).toHaveBeenCalledWith('q-7', 'keep', '')
    })
})
