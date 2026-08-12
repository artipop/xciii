import {onAgentEvent} from './agentEvents'

const anyWindow = window as any
const anyGlobal = global as any

// A socket a test can open, drop and inspect. It stands in for the polyfill in
// src/test, which connects to nothing on purpose.
class FakeSocket {
    static instances: FakeSocket[] = []

    onopen: ((event?: unknown) => void) | null = null
    onclose: ((event?: unknown) => void) | null = null
    onerror: ((event?: unknown) => void) | null = null
    onmessage: ((event: {data: string}) => void) | null = null
    closed = false

    constructor(public url: string) {
        FakeSocket.instances.push(this)
    }

    close() {
        this.closed = true
        this.onclose?.()
    }

    deliver(event: string, data: unknown) {
        this.onmessage?.({data: JSON.stringify({event, data})})
    }
}

const only = () => FakeSocket.instances[FakeSocket.instances.length - 1]

describe('components/acp/agentEvents', () => {
    let realWebSocket: unknown

    beforeEach(() => {
        FakeSocket.instances = []
        realWebSocket = anyGlobal.WebSocket
        anyGlobal.WebSocket = FakeSocket
        anyWindow.go = {main: {App: {ListAgentProjects: vi.fn()}}}
    })

    afterEach(() => {
        anyGlobal.WebSocket = realWebSocket
        delete anyWindow.go
    })

    // The whole reason this module exists: the same page has to hear about
    // agents whether it is drawn in the app's own window or on a phone that
    // reached the front door over the tailnet.
    it('delivers what the front door sends to the subscriber that asked for it', () => {
        const sessions: any[] = []
        const terminals: any[] = []
        const offSession = onAgentEvent('acp:session', (payload) => sessions.push(payload))
        const offTerminal = onAgentEvent('acp:terminal', (payload) => terminals.push(payload))

        only().deliver('acp:session', {cardId: 'card-1'})

        expect(sessions).toEqual([{cardId: 'card-1'}])
        expect(terminals).toEqual([])

        offSession()
        offTerminal()
    })

    // A board full of cards is a page full of subscribers, and one connection
    // is what they are meant to share.
    it('opens one socket however many subscribers there are', () => {
        const offOne = onAgentEvent('acp:session', () => undefined)
        const offTwo = onAgentEvent('acp:attention', () => undefined)

        expect(FakeSocket.instances).toHaveLength(1)

        offOne()
        offTwo()
    })

    // Nothing arrives while the socket is down, so the subscriber is told to
    // look again rather than left showing what was true before the gap.
    it('tells every subscriber to look again when the socket reconnects', () => {
        const seen: any[] = []
        const off = onAgentEvent('acp:attention', (payload) => seen.push(payload))

        only().onopen?.()

        expect(seen).toEqual([undefined])
        off()
    })

    // The last subscriber leaving is a page that has gone: holding the socket
    // open after it would keep a phone awake for nothing.
    it('closes the socket when the last subscriber leaves', () => {
        const off = onAgentEvent('acp:session', () => undefined)
        const socket = only()

        off()

        expect(socket.closed).toBe(true)
    })

    // The same bundle runs in a browser and as a plugin, where there is no
    // desktop app behind the page and therefore no socket to open.
    it('opens nothing where there are no agents to hear about', () => {
        delete anyWindow.go

        const off = onAgentEvent('acp:session', () => undefined)

        expect(FakeSocket.instances).toHaveLength(0)
        off()
    })
})
