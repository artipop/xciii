import {render, screen, waitFor} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {Archiver} from '../../archiver'

import {CsvExporter} from '../../csvExporter'

import ViewHeaderActionsMenu from './viewHeaderActionsMenu'

vi.mock('../../archiver')
vi.mock('../../csvExporter')
vi.mock('../../mutator')
const mockedArchiver = vi.mocked(Archiver)
const mockedCsvExporter = vi.mocked(CsvExporter)

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)
const card = TestBlockFactory.createCard(board)

// The board a source already feeds: it has «Входящие», so that is where the
// question about sources is asked and the board's own menu says nothing of it.
const inboxView = TestBlockFactory.createBoardView(board)
inboxView.id = 'view-inbox'
inboxView.title = 'Входящие'
const withAnInbox = {
    boards: {current: board.id},
    views: {views: {[inboxView.id]: inboxView}, current: activeView.id},
}

describe('components/viewHeader/viewHeaderActionsMenu', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1',
            },
        },
    }
    const store = mockAppStore(state)
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('return menu', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderActionsMenu
                        board={board}
                        activeView={activeView}
                        cards={[card]}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {
            name: 'View header menu',
        })
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })

    test('return menu and verify call to csv exporter', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderActionsMenu
                        board={board}
                        activeView={activeView}
                        cards={[card]}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'View header menu'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonExportCSV = screen.getByRole('button', {name: 'Export to CSV'})
        userEvent.click(buttonExportCSV)
        expect(mockedCsvExporter.exportTableCsv).toHaveBeenCalledTimes(1)
    })

    // This menu is about the board and nothing else. The registries it used to
    // open belong to the machine and live in the sidebar's settings, where they
    // are reachable with no board open — which is the whole point of moving
    // them, and is exactly what a regression here would undo.
    describe('the menu holds what is true of this board', () => {
        const anyWindow = window as any

        beforeEach(() => {
            anyWindow.go = {main: {App: {
                ListAgents: vi.fn(),
                ListDeployTargets: vi.fn(),
                ListAgentWorkdirs: vi.fn(),
                ListFlows: vi.fn(),
                ListSources: vi.fn().mockResolvedValue('[]'),
                ExportBoardAutomation: vi.fn(),
                BoardSetupPlan: vi.fn().mockResolvedValue('{"steps":[]}'),
            }}}
            render(() =>
                wrapIntl(() =>
                    <AppStoreProvider store={mockAppStore({...state, ...withAnInbox})}>
                        <ViewHeaderActionsMenu
                            board={board}
                            activeView={activeView}
                            cards={[card]}
                        />
                    </AppStoreProvider>,
                ),
            )
            userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        })
        afterEach(() => {
            delete anyWindow.go
        })

        test('the one screen that says what this board does is offered', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'Columns and routes…'})).toBeInTheDocument())
        })

        // Making a template is a rare, deliberate act and no longer stands in
        // the menu of every board (OFFER_SAVE_AS_TEMPLATE).
        test('saving the board as a template is not', () => {
            expect(screen.queryByRole('button', {name: 'Save as a template…'})).toBeNull()
        })

        test('the machine registries are not', () => {
            for (const gone of ['Agents…', 'Deploy targets…', 'Plan a task…']) {
                expect(screen.queryByRole('button', {name: gone})).toBeNull()
            }
        })

        // A board that asks for nothing is offered nothing: the setup steps in
        // the menu are this board's own, not a fixed list.
        test('a board with no setup questions is offered none of them', () => {
            for (const gone of ['Folders…', 'Where to deploy…', 'Walk the setup again…', 'The board’s system prompt…']) {
                expect(screen.queryByRole('button', {name: gone})).toBeNull()
            }
        })

        // Where cards come from is a question about «Входящие», and that is
        // where it is answered now. On the board itself it was one more thing
        // to walk past.
        test('and neither are the sources of a board', () => {
            expect(screen.queryByRole('button', {name: 'Sources…'})).toBeNull()
        })
    })

    // The setup questions a board asks are its own screens in its own menu.
    // They used to be folds of «Колонки и маршруты…», where setting up
    // where an agent works was filed under columns and routes — and a fold
    // under a canvas is a place nobody opens.
    describe('a board offers the setup steps it asks for', () => {
        const anyWindow = window as any

        beforeEach(() => {
            anyWindow.go = {main: {App: {
                ListAgents: vi.fn(),
                ListDeployTargets: vi.fn(),
                ListAgentWorkdirs: vi.fn(),
                ListFlows: vi.fn(),
                ListSources: vi.fn().mockResolvedValue('[]'),
                ExportBoardAutomation: vi.fn(),
                GetBoardPrompt: vi.fn().mockResolvedValue(''),
                BoardSetupPlan: vi.fn().mockResolvedValue(JSON.stringify({
                    steps: [
                        {kind: 'project', optional: false, status: 'pending'},
                        {kind: 'agent', optional: false, status: 'pending'},
                        {kind: 'deploy', optional: true, status: 'pending'},
                    ],
                })),
            }}}
            render(() =>
                wrapIntl(() =>
                    <AppStoreProvider store={mockAppStore({...state, ...withAnInbox})}>
                        <ViewHeaderActionsMenu
                            board={board}
                            activeView={activeView}
                            cards={[card]}
                        />
                    </AppStoreProvider>,
                ),
            )
            userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        })
        afterEach(() => {
            delete anyWindow.go
        })

        test('the folders and the deploy targets are each their own item', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'Folders…'})).toBeInTheDocument())
            expect(screen.getByRole('button', {name: 'Where to deploy…'})).toBeInTheDocument()
        })

        // What the board's agents are told first is the board's own answer
        // too, and it was a fold at the bottom of the route canvas.
        test('and so is what the board tells its agents', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'The board’s system prompt…'})).toBeInTheDocument())
        })

        // The way back to the questions, which used to be a button at the
        // bottom of another dialog.
        test('and so is walking the setup again', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'Walk the setup again…'})).toBeInTheDocument())
        })
    })

    // «Входящие» is the screen about what arrives, so its menu is about that
    // and about nothing else: exporting or saving as a template are questions
    // about the board, asked where the board is.
    describe('on «Входящие» the menu is the sources and nothing else', () => {
        const anyWindow = window as any

        beforeEach(() => {
            anyWindow.go = {main: {App: {
                ListSources: vi.fn().mockResolvedValue('[]'),
                ListFlows: vi.fn(),
            }}}
            render(() =>
                wrapIntl(() =>
                    <AppStoreProvider store={mockAppStore({...state, ...withAnInbox})}>
                        <ViewHeaderActionsMenu
                            board={board}
                            activeView={inboxView}
                            cards={[card]}
                        />
                    </AppStoreProvider>,
                ),
            )
            userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        })
        afterEach(() => {
            delete anyWindow.go
        })

        test('the sources are offered here', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'Sources…'})).toBeInTheDocument())
        })

        test('the board menu is not', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'Sources…'})).toBeInTheDocument())
            for (const gone of ['Export to CSV', 'Export board archive', 'Columns and routes…', 'Save as a template…']) {
                expect(screen.queryByRole('button', {name: gone})).toBeNull()
            }
        })
    })

    // A build with no Go side behind it — the plugin, a browser — has no
    // sources to offer, and an inbox menu with nothing in it is a button that
    // opens an empty box.
    test('with nothing to offer, «Входящие» has no menu at all', () => {
        render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={mockAppStore({...state, ...withAnInbox})}>
                    <ViewHeaderActionsMenu
                        board={board}
                        activeView={inboxView}
                        cards={[card]}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(screen.queryByRole('button', {name: 'View header menu'})).toBeNull()
    })

    // A board made empty has no «Входящие» — the view arrives with the first
    // source — so the door to make one has to stay on the board itself, or
    // there is no way to add a source to such a board at all.
    test('a board with no «Входящие» keeps the sources in its own menu', async () => {
        const anyWindow = window as any
        anyWindow.go = {main: {App: {
            ListSources: vi.fn().mockResolvedValue('[]'),
            ListFlows: vi.fn(),
        }}}
        render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={mockAppStore({...state, boards: {current: board.id}, views: {views: {}, current: activeView.id}})}>
                    <ViewHeaderActionsMenu
                        board={board}
                        activeView={activeView}
                        cards={[card]}
                    />
                </AppStoreProvider>,
            ),
        )
        userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        await waitFor(() => expect(screen.getByRole('button', {name: 'Sources…'})).toBeInTheDocument())
        expect(screen.getByRole('button', {name: 'Export to CSV'})).toBeInTheDocument()
        delete anyWindow.go
    })

    test('return menu and verify call to board archive', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderActionsMenu
                        board={board}
                        activeView={activeView}
                        cards={[card]}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'View header menu'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonExportBoardArchive = screen.getByRole('button', {name: 'Export board archive'})
        userEvent.click(buttonExportBoardArchive)
        expect(mockedArchiver.exportBoardArchive).toHaveBeenCalledTimes(1)
        expect(mockedArchiver.exportBoardArchive).toHaveBeenCalledWith(board)
    })
})
