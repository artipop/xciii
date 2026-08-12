import {fireEvent, render, screen, waitFor, within} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {TestRouter, mockAppStore, mockDOM, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'
import {TestBlockFactory} from '../test/testBlockFactory'
import {IPropertyTemplate} from '../blocks/board'
import {Utils} from '../utils'
import {IUser} from '../user'
import octoClient from '../octoClient'
import Mutator from '../mutator'
import {Constants} from '../constants'

import CenterPanel from './centerPanel'
Object.defineProperty(Constants, 'versionString', {value: '1.0.0'})

vi.mock('../utils')
vi.mock('../octoClient')
vi.mock('../mutator')
vi.mock('../telemetry/telemetryClient')
const mockedUtils = vi.mocked(Utils)
const mockedMutator = vi.mocked(Mutator)
const mockedOctoClient = vi.mocked(octoClient)
mockedUtils.createGuid.mockReturnValue('test-id')
mockedUtils.generateClassName = (await vi.importActual<typeof import('../utils')>('../utils')).Utils.generateClassName
describe('components/centerPanel', () => {
    const board = TestBlockFactory.createBoard()
    board.id = '1'
    board.teamId = 'team-id'
    const activeView = TestBlockFactory.createBoardView(board)
    activeView.id = '1'
    const card1 = TestBlockFactory.createCard(board)
    card1.id = '1'
    card1.title = 'card1'
    card1.fields.isTemplate = true
    card1.fields.properties = {id: 'property_value_id_1'}
    const card2 = TestBlockFactory.createCard(board)
    card2.id = '2'
    card2.title = 'card2'
    card2.fields.properties = {id: 'property_value_id_1'}
    const comment1 = TestBlockFactory.createComment(card1)
    comment1.id = '1'
    const comment2 = TestBlockFactory.createComment(card2)
    comment2.id = '2'
    const groupProperty: IPropertyTemplate = {
        id: 'id',
        name: 'name',
        type: 'text',
        options: [
            {
                color: 'propColorOrange',
                id: 'property_value_id_1',
                value: 'Q1',
            },
            {
                color: 'propColorBlue',
                id: 'property_value_id_2',
                value: 'Q2',
            },
        ],
    }
    const state = {
        clientConfig: {
            value: {},
        },
        searchText: '',
        users: {
            me: {
                id: 'user_id_1',
            },
            myConfig: {
                onboardingTourStarted: {value: false},
            },
            boardUsers: {
                'user-id-1': {username: 'username_1'},
            },
            blockSubscriptions: [],
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            templates: [],
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        limits: {
            limits: {
                cards: 0,
                used_cards: 0,
                card_limit_timestamp: 0,
                views: 0,
            },
        },
        cards: {
            templates: {
                [card1.id]: card1,
                [card2.id]: card2,
            },
            cards: {
                [card1.id]: card1,
                [card2.id]: card2,
            },
            current: card1.id,
        },
        views: {
            views: {
                [activeView.id]: activeView,
            },
            current: activeView.id,
        },
        contents: {
            contents: [],
            contentsByCard: {},
        },
        comments: {
            comments: [comment1, comment2],
            commentsByCard: {
                [card1.id]: [comment1],
                [card2.id]: [comment2],
            },
        },
    }
    mockedOctoClient.searchTeamUsers.mockResolvedValue(Object.values(state.users.boardUsers) as IUser[])
    const store = mockAppStore(state)
    beforeAll(() => {
        mockDOM()
        console.error = vi.fn()
    })
    beforeEach(() => {
        activeView.fields.viewType = 'board'
        vi.clearAllMocks()
    })

    // The setup wizard: it opens once per board, and what it leaves unanswered
    // is what the header quietly goes on saying.
    describe('the setup a board still needs', () => {
        const anyWindow = window as any
        const setupBoard = TestBlockFactory.createBoard()
        setupBoard.id = 'board-needing-setup'
        setupBoard.teamId = 'team-id'

        // A stand-in for the store: what Go remembers about this board, which
        // is the whole point — it outlives the page, and the page is what a
        // restart throws away.
        const stubPlan = (steps: Array<Record<string, unknown>>) => {
            let offered = false
            anyWindow.go = {main: {App: {
                BoardSetupPlan: vi.fn().mockImplementation(() => Promise.resolve(JSON.stringify({
                    boardId: setupBoard.id, steps, declared: true, automated: true, offered,
                }))),
                MarkBoardSetupOffered: vi.fn().mockImplementation(() => {
                    offered = true
                    return Promise.resolve()
                }),
                RecordBoardSetupStep: vi.fn().mockResolvedValue(undefined),
                ListAgentProjects: vi.fn().mockResolvedValue('[]'),
                ListAgents: vi.fn().mockResolvedValue('[]'),
            }}}
        }
        const renderPanel = () => render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1]}
                        views={[activeView]}
                        board={setupBoard}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        hiddenCardsCount={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))

        afterEach(() => {
            delete anyWindow.go
            localStorage.clear()
        })

        test('opens by itself for a board that has not been through it', async () => {
            stubPlan([{kind: 'project', optional: false, status: 'pending'}, {kind: 'done', optional: false, status: 'done'}])
            renderPanel()
            await waitFor(() => expect(screen.getByText('Set up this board: Project')).toBeInTheDocument())
        })

        // Closing it half-way is an answer to "have you seen this?", not to any
        // of the questions in it: the board still needs setting up, and says so,
        // but the modal does not come back by itself.
        // Throwing the page away and building it again is what a restart looks
        // like from here — and localStorage would not have survived it, because
        // the app serves itself on a fresh port, and therefore a fresh origin,
        // every launch.
        test('does not open twice, and the reminder stays while a question is unanswered', async () => {
            stubPlan([{kind: 'project', optional: false, status: 'pending'}, {kind: 'done', optional: false, status: 'done'}])
            const first = renderPanel()
            await waitFor(() => expect(screen.getByText('Set up this board: Project')).toBeInTheDocument())
            await waitFor(() => expect(anyWindow.go.main.App.MarkBoardSetupOffered).toHaveBeenCalledWith(setupBoard.id))
            first.unmount()

            localStorage.clear()
            renderPanel()
            await waitFor(() => expect(screen.getByText('This board is not set up yet')).toBeInTheDocument())
            expect(screen.queryByText('Set up this board: Project')).toBeNull()
        })

        test('and the reminder goes when every question this board asks is answered', async () => {
            stubPlan([
                {kind: 'project', optional: false, status: 'done'},
                {kind: 'deploy', optional: true, status: 'skipped'},
                {kind: 'done', optional: false, status: 'done'},
            ])
            renderPanel()
            await waitFor(() => expect(screen.queryByText('Set up this board: Project')).toBeNull())
            expect(screen.queryByText('This board is not set up yet')).toBeNull()
        })
    })
    test('should match snapshot for Kanban, not shared', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1]}
                        views={[activeView]}
                        board={board}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        shownCardId={card1.id}
                        hiddenCardsCount={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot for Kanban', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1]}
                        views={[activeView]}
                        board={board}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        shownCardId={card1.id}
                        hiddenCardsCount={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot for Gallery', () => {
        activeView.fields.viewType = 'gallery'
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1]}
                        views={[activeView]}
                        board={board}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        shownCardId={card1.id}
                        hiddenCardsCount={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot for Table', () => {
        activeView.fields.viewType = 'table'
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1]}
                        views={[activeView]}
                        board={board}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        shownCardId={card1.id}
                        hiddenCardsCount={0}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    describe('return centerPanel and', () => {
        const rowTitle = (name: string) => screen.getAllByRole('textbox', {name}).find((el) => el.tagName === 'INPUT')!

        test('select one card and click background', () => {
            activeView.fields.viewType = 'table'
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))

            //select card
            const cardElement = rowTitle('card1')
            expect(cardElement).not.toBeNull()
            userEvent.click(cardElement, {shiftKey: true})
            expect(container).toMatchSnapshot()

            //background
            const boardElement = container.querySelector('.BoardComponent')
            expect(boardElement).not.toBeNull()
            userEvent.click(boardElement!)
            expect(container).toMatchSnapshot()
        })

        test('press touch 1 with readonly', () => {
            activeView.fields.viewType = 'table'
            const {container, baseElement} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={true}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))

            //touch '1'
            fireEvent.keyDown(baseElement, {key: '1', code: 'Digit1'})
            expect(container).toMatchSnapshot()
        })

        test('press touch esc for one card selected', () => {
            activeView.fields.viewType = 'table'
            const {container, baseElement} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))

            const cardElement = rowTitle('card1')
            expect(cardElement.parentNode).not.toBeNull()
            userEvent.click(cardElement as HTMLElement, {shiftKey: true})
            expect(container).toMatchSnapshot()

            //escape
            fireEvent.keyDown(baseElement, {key: 'Escape'})
            expect(container).toMatchSnapshot()
        })
        test('press touch esc for two cards selected', async () => {
            activeView.fields.viewType = 'table'
            const {container, baseElement} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))

            //select card1
            const card1Element = rowTitle('card1')
            expect(card1Element).not.toBeNull()
            userEvent.click(card1Element, {shiftKey: true})
            expect(container).toMatchSnapshot()

            //select card2
            const card2Element = rowTitle('card2')
            expect(card2Element).not.toBeNull()
            userEvent.click(card2Element, {shiftKey: true, ctrlKey: true})
            expect(container).toMatchSnapshot()

            //escape
            fireEvent.keyDown(baseElement, {key: 'Escape'})
            expect(container).toMatchSnapshot()
        })
        test('press touch del for one card selected', () => {
            activeView.fields.viewType = 'table'
            const {container, baseElement} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const cardElement = rowTitle('card1')
            expect(cardElement).not.toBeNull()
            userEvent.click(cardElement, {shiftKey: true})
            expect(container).toMatchSnapshot()

            //delete
            fireEvent.keyDown(baseElement, {key: 'Backspace'})
            expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
        })
        test('press touch ctrl+d for one card selected', () => {
            activeView.fields.viewType = 'table'
            const {container, baseElement} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const cardElement = rowTitle('card1')
            expect(cardElement).not.toBeNull()
            userEvent.click(cardElement, {shiftKey: true})
            expect(container).toMatchSnapshot()

            //ctrl+d
            fireEvent.keyDown(baseElement, {ctrlKey: true, key: 'd', code: 'KeyD'})
            expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
        })
        test('click on card to show card', () => {
            activeView.fields.viewType = 'board'
            const mockedShowCard = vi.fn()
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={mockedShowCard}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))

            const kanbanCardElements = container.querySelectorAll('.KanbanCard')
            expect(kanbanCardElements).not.toBeNull()
            const kanbanCardElement = kanbanCardElements[0]
            userEvent.click(kanbanCardElement)
            expect(container).toMatchSnapshot()
            expect(mockedShowCard).toHaveBeenCalledWith(card1.id)
        })
        test('click on new card to add card', () => {
            activeView.fields.viewType = 'table'
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const buttonWithMenuElement = container.querySelector('.ButtonWithMenu')
            expect(buttonWithMenuElement).not.toBeNull()
            userEvent.click(buttonWithMenuElement!)
            expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
        })
        test('click on new card to add card template', () => {
            activeView.fields.viewType = 'table'
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const elementMenuWrapper = container.querySelector('.ButtonWithMenu > div.MenuWrapper')
            expect(elementMenuWrapper).not.toBeNull()
            userEvent.click(elementMenuWrapper!)
            const buttonNewTemplate = within(elementMenuWrapper!.parentElement!).getByRole('button', {name: 'New template'})
            userEvent.click(buttonNewTemplate)
            expect(mockedMutator.insertBlock).toHaveBeenCalledTimes(1)
        })

        test('click on new card to add card from template', () => {
            activeView.fields.viewType = 'table'
            activeView.fields.defaultTemplateId = '1'
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const elementMenuWrapper = container.querySelector('.ButtonWithMenu > div.MenuWrapper')
            expect(elementMenuWrapper).not.toBeNull()
            userEvent.click(elementMenuWrapper!)
            const elementCard1 = within(elementMenuWrapper!.parentElement!).getByRole('button', {name: 'card1'})
            expect(elementCard1).not.toBeNull()
            userEvent.click(elementCard1)
            expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
        })

        test('click on new card to edit template', () => {
            activeView.fields.viewType = 'table'
            activeView.fields.defaultTemplateId = '1'
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <TestRouter>
                        <CenterPanel
                            cards={[card1, card2]}
                            views={[activeView]}
                            board={board}
                            activeView={activeView}
                            readonly={false}
                            showCard={vi.fn()}
                            groupByProperty={groupProperty}
                            shownCardId={card1.id}
                            hiddenCardsCount={0}
                        />
                    </TestRouter>
                </AppStoreProvider>,
            ))
            const elementMenuWrapper = container.querySelector('.ButtonWithMenu > div.MenuWrapper')
            expect(elementMenuWrapper).not.toBeNull()
            userEvent.click(elementMenuWrapper!)
            const elementCard1 = within(elementMenuWrapper!.parentElement!).getByRole('button', {name: 'card1'})
            expect(elementCard1).not.toBeNull()
            const elementMenuWrapperCard1 = within(elementCard1).getByRole('button', {name: 'menuwrapper'})
            expect(elementMenuWrapperCard1).not.toBeNull()
            userEvent.click(elementMenuWrapperCard1)
            const elementEditMenuTemplate = within(elementMenuWrapperCard1).getByRole('button', {name: 'Edit'})
            expect(elementMenuWrapperCard1).not.toBeNull()
            userEvent.click(elementEditMenuTemplate)
            expect(container).toMatchSnapshot()
        })
    })
})

describe('components/centerPanel', () => {
    const board = TestBlockFactory.createBoard()
    board.id = '1'
    const activeView = TestBlockFactory.createBoardView(board)
    activeView.id = '1'
    const card1 = TestBlockFactory.createCard(board)
    card1.id = '1'
    card1.title = 'card1'
    card1.fields.properties = {id: 'property_value_id_1'}
    card1.limited = true
    const card2 = TestBlockFactory.createCard(board)
    card2.id = '2'
    card2.title = 'card2'
    card2.fields.properties = {id: 'property_value_id_1'}
    card2.limited = true
    const comment1 = TestBlockFactory.createComment(card1)
    comment1.id = '1'
    const comment2 = TestBlockFactory.createComment(card2)
    comment2.id = '2'
    const groupProperty: IPropertyTemplate = {
        id: 'id',
        name: 'name',
        type: 'text',
        options: [
            {
                color: 'propColorOrange',
                id: 'property_value_id_1',
                value: 'Q1',
            },
            {
                color: 'propColorBlue',
                id: 'property_value_id_2',
                value: 'Q2',
            },
        ],
    }
    const state = {
        clientConfig: {
            value: {},
        },
        searchText: '',
        users: {
            me: {
                id: 'user_id_1',
            },
            myConfig: {
                onboardingTourStarted: {value: false},
            },
            workspaceUsers: [
                {username: 'username_1'},
            ],
            boardUsers: [
                {username: 'username_1'},
            ],
            blockSubscriptions: [],
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            templates: [],
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        cards: {
            templates: {
                [card1.id]: card1,
                [card2.id]: card2,
            },
            cards: {
                [card1.id]: card1,
                [card2.id]: card2,
            },
            current: card1.id,
        },
        views: {
            views: {
                [activeView.id]: activeView,
            },
            current: activeView.id,
        },
        contents: {},
        comments: {
            comments: [comment1, comment2],
        },
        limits: {
            limits: {
                views: 0,
            },
        },
    }
    const store = mockAppStore(state)
    beforeAll(() => {
        mockDOM()
        console.error = vi.fn()
    })
    beforeEach(() => {
        activeView.fields.viewType = 'board'
        vi.clearAllMocks()
    })

    test('Clicking on the Hidden card count should open a dailog', () => {
        activeView.fields.viewType = 'table'
        activeView.fields.defaultTemplateId = '1'
        const {container, getByTitle, getByText} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <CenterPanel
                        cards={[card1, card2]}
                        views={[activeView]}
                        board={board}
                        activeView={activeView}
                        readonly={false}
                        showCard={vi.fn()}
                        groupByProperty={groupProperty}
                        shownCardId={card1.id}
                        hiddenCardsCount={2}
                    />
                </TestRouter>
            </AppStoreProvider>,
        ))
        fireEvent.click(getByTitle('hidden-card-count'))
        expect(getByText('2 cards hidden from board')).not.toBeNull()
        expect(container).toMatchSnapshot()
    })
})
