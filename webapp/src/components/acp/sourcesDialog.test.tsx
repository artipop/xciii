import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {Board, createBoard} from '../../blocks/board'
import {wrapIntl} from '../../testUtils'

import SourcesDialog, {ingestURL, isSourcesAvailable} from './sourcesDialog'

const anyWindow = window as any

const board: Board = {...createBoard(), id: 'board1'}

const renderDialog = () => render(() => wrapIntl(() => (
    <SourcesDialog
        board={board}
        onClose={() => undefined}
    />
)))

describe('components/acp/sourcesDialog', () => {
    beforeEach(() => vi.clearAllMocks())

    afterEach(() => {
        delete anyWindow.go
    })

    it('is inert without desktop bindings', () => {
        expect(isSourcesAvailable()).toBe(false)
    })

    // A source is named in the user's own words, and those are usually Russian:
    // what goes into the address has to survive being typed into curl.
    it('escapes the source name in the address it shows', () => {
        expect(ingestURL('http://127.0.0.1:9000', 'телефон')).
            toBe('http://127.0.0.1:9000/sources/ingest/%D1%82%D0%B5%D0%BB%D0%B5%D1%84%D0%BE%D0%BD')
    })

    it('shows the board its own sources, and where to feed them', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'phone', boardId: 'board1', enabled: true, noisy: true},
            ])),
        }}}

        renderDialog()

        expect(await screen.findByText('phone')).toBeInTheDocument()
        expect(screen.getByText(`${window.location.origin}/sources/ingest/phone`)).toBeInTheDocument()
    })

    // A source made of a plugin: the form comes from the manifest, the token
    // goes to the keychain rather than into the entry, and the ingest address
    // is not shown at all — a plugin fetches, nobody feeds it.
    it('makes a source out of a plugin, with the form its manifest asks for', async () => {
        const AddSource = vi.fn().mockResolvedValue(JSON.stringify({
            name: 'kaiten', boardId: 'board1', enabled: true, plugin: 'kaiten', token: 'ingest-token',
        }))
        const SetSourceCredential = vi.fn().mockResolvedValue(undefined)
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            ListSourcePlugins: vi.fn().mockResolvedValue(JSON.stringify([{
                name: 'kaiten',
                title: 'Kaiten',
                kind: 'mcp',
                auth: {type: 'token'},
                fields: [{key: 'boardId', title: 'Доска Kaiten (id)', type: 'number'}],
            }])),
            SourceStatuses: vi.fn().mockResolvedValue('[]'),
            AddSource,
            SetSourceCredential,
            SourceEvents: vi.fn().mockResolvedValue('[]'),
        }}}

        renderDialog()

        await userEvent.type(await screen.findByPlaceholderText(/Name of the source/), 'kaiten')
        await userEvent.selectOptions(await screen.findByRole('combobox'), 'kaiten')

        // The field the manifest declared, and the token the service issues.
        await userEvent.type(await screen.findByLabelText('Доска Kaiten (id)'), '77')
        await userEvent.type(screen.getByLabelText('Token from the service'), 'kaiten-secret')
        await userEvent.click(screen.getByText('Add'))

        await waitFor(() => expect(AddSource).toHaveBeenCalled())
        const sent = JSON.parse(AddSource.mock.calls[0][0])
        expect(sent.plugin).toBe('kaiten')
        expect(sent.config).toEqual({boardId: '77'})

        // A plugin fetches a list somebody asked for, so what it brings is
        // wanted: with the noisy default left on and no rules written yet,
        // every card would be dropped instead of filed.
        expect(sent.noisy).toBe(false)

        // Stored against the source's name, and after it exists.
        await waitFor(() => expect(SetSourceCredential).toHaveBeenCalledWith('kaiten', 'kaiten-secret'))

        // The ingest token belongs to a source that is fed from outside, and
        // showing it here would be an address nobody should use.
        expect(screen.queryByText('ingest-token')).not.toBeInTheDocument()
    })

    // A plugin that will not start is the failure this integration has: it has
    // no address to test with, so the dialog has to say what it is doing.
    it('says what a plugin source is doing instead of showing an address', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'kaiten', boardId: 'board1', enabled: true, plugin: 'kaiten'},
            ])),
            ListSourcePlugins: vi.fn().mockResolvedValue('[]'),
            SourceStatuses: vi.fn().mockResolvedValue(JSON.stringify([
                {source: 'kaiten', state: 'error', error: 'у MCP-сервера нет инструмента list_my_cards'},
            ])),
        }}}

        renderDialog()

        expect(await screen.findByText(/failed/)).toBeInTheDocument()
        expect(screen.getByText(/list_my_cards/)).toBeInTheDocument()
        expect(screen.queryByText(new RegExp('/sources/ingest/kaiten'))).not.toBeInTheDocument()
    })

    // The token is kept as a hash, so the moment it is issued is the only
    // moment it can be read. A dialog that failed to show it would leave a
    // source nothing can ever send to.
    it('shows the token once, when the source is created', async () => {
        const AddSource = vi.fn().mockResolvedValue(JSON.stringify({
            name: 'phone', boardId: 'board1', enabled: true, token: 'secret-token',
        }))
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            AddSource,
            SourceEvents: vi.fn().mockResolvedValue('[]'),
        }}}

        renderDialog()
        await userEvent.type(await screen.findByPlaceholderText(/Name of the source/), 'phone')
        await userEvent.click(screen.getByText('Add'))

        expect(await screen.findByText('secret-token')).toBeInTheDocument()
        const sent = JSON.parse(AddSource.mock.calls[0][0])
        expect(sent.boardId).toBe('board1')
        expect(sent.noisy).toBe(true)
    })

    // "Why did nothing happen" is the only question a source is ever asked, and
    // an item that matched no rule is the commonest answer.
    it('says what became of what a source brought', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'phone', boardId: 'board1', enabled: true, noisy: false},
            ])),
            SourceEvents: vi.fn().mockResolvedValue(JSON.stringify([
                {id: 2, source: 'phone', outcome: 'inbox', externalId: 'n2'},
                {id: 1, source: 'phone', outcome: 'created', rule: 'доставка'},
            ])),
        }}}

        renderDialog()
        await userEvent.click(await screen.findByText('Log'))

        expect(await screen.findByText('no rule matched, filed in the inbox')).toBeInTheDocument()
        expect(screen.getByText('card created')).toBeInTheDocument()
    })

    it('reports what the desktop refused', async () => {
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            AddSource: vi.fn().mockRejectedValue(new Error('источник "phone" уже есть')),
        }}}

        renderDialog()
        await userEvent.type(await screen.findByPlaceholderText(/Name of the source/), 'phone')
        await userEvent.click(screen.getByText('Add'))

        await waitFor(() => expect(screen.getByText('источник "phone" уже есть')).toBeInTheDocument())
    })
})
