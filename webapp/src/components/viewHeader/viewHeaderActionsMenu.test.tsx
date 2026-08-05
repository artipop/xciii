// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@solidjs/testing-library'

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

    // The registries are per machine, but what a board needs from them is not:
    // offering a Dokku host to a board of household chores is offering a setting
    // that can never do anything.
    describe('the board decides which registries are worth opening', () => {
        const anyWindow = window as any
        const openMenuFor = (properties: Record<string, unknown>) => {
            const themed = TestBlockFactory.createBoard()
            themed.properties = properties as any
            render(() =>
                wrapIntl(() =>
                    <AppStoreProvider store={store}>
                        <ViewHeaderActionsMenu
                            board={themed}
                            activeView={activeView}
                            cards={[card]}
                        />
                    </AppStoreProvider>,
                ),
            )
            userEvent.click(screen.getByRole('button', {name: 'View header menu'}))
        }

        beforeEach(() => {
            anyWindow.go = {main: {App: {ListDeployTargets: vi.fn(), ListAgentProjects: vi.fn()}}}
        })
        afterEach(() => {
            delete anyWindow.go
        })

        test('a board that publishes is offered somewhere to publish to', () => {
            openMenuFor({acpColumns: [{column: 'Deploy', action: 'deploy'}], acpFlows: []})
            expect(screen.getByRole('button', {name: 'Deploy targets…'})).toBeInTheDocument()
        })

        test('a board that only runs an agent is not', () => {
            openMenuFor({acpColumns: [{column: 'Агент готовит', action: 'agent'}], acpFlows: []})
            expect(screen.queryByRole('button', {name: 'Deploy targets…'})).toBeNull()

            // The registries it does use are still there.
            expect(screen.getByRole('button', {name: 'Projects…'})).toBeInTheDocument()
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
