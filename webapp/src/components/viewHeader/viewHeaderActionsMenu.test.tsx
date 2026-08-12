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
                ListAgentProjects: vi.fn(),
                ListFlows: vi.fn(),
                ExportBoardAutomation: vi.fn(),
                BoardSetupPlan: vi.fn().mockResolvedValue('{"steps":[]}'),
            }}}
            render(() =>
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
            userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        })
        afterEach(() => {
            delete anyWindow.go
        })

        test('the one screen that says what this board does is offered', async () => {
            await waitFor(() => expect(screen.getByRole('button', {name: 'How this board works…'})).toBeInTheDocument())
        })

        test('the machine registries are not', () => {
            for (const gone of ['Agents…', 'Deploy targets…', 'Projects…', 'Set up this board…', 'Plan a task…']) {
                expect(screen.queryByRole('button', {name: gone})).toBeNull()
            }
        })
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
