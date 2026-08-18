import 'isomorphic-fetch'
import {render, waitFor} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {FetchMock} from '../../test/fetchMock'
import {TestBlockFactory} from '../../test/testBlockFactory'

import {mockAppStore, mockDOM, wrapDNDIntl, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import octoClient from '../../octoClient'

import {createTextBlock} from '../../blocks/textBlock'

import CardDetail from './cardDetail'

global.fetch = FetchMock.fn
vi.mock('../../octoClient')

const mockedOctoClient = vi.mocked(octoClient)

beforeEach(() => {
    FetchMock.fn.mockReset()
})

// The desktop bindings are global, and a card left holding them decides for
// every test after it whether this app has an agent integration at all.
afterEach(() => {
    delete (window as any).go
})

// This is needed to run EasyMDE in tests.
// It needs bounding rectangle box property
// on HTML elements, but Jest's HTML engine jsdom
// doesn't provide it.
// So we mock it.
beforeAll(() => {
    mockDOM()
})

describe('components/cardDetail/CardDetail', () => {
    const board = TestBlockFactory.createBoard()

    const view = TestBlockFactory.createBoardView(board)
    view.fields.sortOptions = []
    view.fields.groupById = undefined
    view.fields.hiddenOptionIds = []

    const card = TestBlockFactory.createCard(board)

    const createdAt = Date.parse('01 Jan 2021 00:00:00 GMT')
    const comment1 = TestBlockFactory.createComment(card)
    comment1.type = 'comment'
    comment1.title = 'Comment 1'
    comment1.parentId = card.id
    comment1.createAt = createdAt

    const comment2 = TestBlockFactory.createComment(card)
    comment2.type = 'comment'
    comment2.title = 'Comment 2'
    comment2.parentId = card.id
    comment2.createAt = createdAt

    // Commented out with the comments themselves (cardDetail.tsx): the list
    // is not drawn while this app has one person in it. The test comes back
    // when the feature does — docs/teamwork.md.
    /*
    test('should show comments', async () => {
        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [board.id]: board,
                },
                current: board.id,
                myBoardMemberships: {
                    [board.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    [card.id]: card,
                },
                current: card.id,
            },
            clientConfig: {
                value: {},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CardDetail
                        board={board}
                        activeView={view}
                        views={[view]}
                        cards={[card]}
                        card={card}
                        comments={[comment1, comment2]}
                        contents={[]}
                        attachments={[]}
                        readonly={false}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        )

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()

        // Comments show up
        const comments = container!.querySelectorAll('.comment-text')
        expect(comments.length).toBe(2)

        // Add comment option visible when readonly mode is off
        const newCommentSection = container!.querySelectorAll('.newcomment')
        expect(newCommentSection.length).toBe(1)
    })
    */

    // A rule across the card means a section starts here. The route strip
    // learns only after its data arrives whether it has anything to show, so a
    // rule written beside it in the card stood over nothing on every card
    // without a route.
    //
    // The agent's own controls are not in the card at all any more — the
    // terminal is a panel beside it, opened from the dialog's toolbar — so
    // there is nothing here for them to draw a rule for either.
    test('draws no rule for a section it is not drawing', async () => {
        const bindings = {
            GetCardAgent: vi.fn().mockResolvedValue('{}'),
            GetCardFlow: vi.fn().mockResolvedValue('null'),
            OpenCardTerminal: vi.fn(),
            ListAgents: vi.fn().mockResolvedValue('[]'),
            ListAgentWorkdirs: vi.fn().mockResolvedValue('[]'),
        };
        (window as any).go = {main: {App: bindings}}

        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [board.id]: board,
                },
                current: board.id,
                myBoardMemberships: {
                    [board.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    [card.id]: card,
                },
                current: card.id,
            },
            clientConfig: {
                value: {},
            },
        })

        const {container} = render(() => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CardDetail
                        board={board}
                        activeView={view}
                        views={[view]}
                        cards={[card]}
                        card={card}
                        comments={[comment1]}
                        contents={[]}
                        attachments={[]}
                        readonly={false}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        ))

        await waitFor(() => expect(bindings.GetCardFlow).toHaveBeenCalled())

        expect(container.querySelector('.FlowStrip')).toBeNull()
        expect(container.querySelector('.CardTerminal')).toBeNull()

        // Nothing under the properties has anything to show — no attachments,
        // no route — so the card draws no rule at all. A rule belongs to the
        // section under it, and a card with no such section draws none.
        expect(container.querySelectorAll('hr').length).toBe(0)
    })

    // Commented out with the comments themselves (cardDetail.tsx): the list
    // is not drawn while this app has one person in it. The test comes back
    // when the feature does — docs/teamwork.md.
    /*
    test('should show comments in readonly view', async () => {
        const store = mockAppStore({
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [board.id]: board,
                },
                current: board.id,
                myBoardMemberships: {
                    [board.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            clientConfig: {
                value: {},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CardDetail
                        board={board}
                        activeView={view}
                        views={[view]}
                        cards={[card]}
                        card={card}
                        comments={[comment1, comment2]}
                        contents={[]}
                        attachments={[]}
                        readonly={true}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        )

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()

        // comments show up
        const comments = container!.querySelectorAll('.comment-text')
        expect(comments.length).toBe(2)

        // Add comment option is not shown in readonly mode
        const newCommentSection = container!.querySelectorAll('.newcomment')
        expect(newCommentSection.length).toBe(0)
    })
    */

    test('should show add properties tour tip', async () => {
        const welcomeBoard = TestBlockFactory.createBoard()
        welcomeBoard.title = 'Welcome to Boards!'

        const welcomeCard = TestBlockFactory.createCard(welcomeBoard)
        welcomeCard.title = 'Create a new card'

        const store = mockAppStore({
            users: {
                me: {
                    id: 'user_id_1',
                },
                myConfig: {
                    welcomePageViewed: {value: '1'},
                    onboardingTourStarted: {value: true},
                    tourCategory: {value: 'card'},
                    onboardingTourStep: {value: '0'},
                },
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [welcomeBoard.id]: welcomeBoard,
                },
                current: welcomeBoard.id,
                myBoardMemberships: {
                    [welcomeBoard.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    [welcomeCard.id]: welcomeCard,
                },
                current: welcomeCard.id,
            },
            clientConfig: {
                value: {},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CardDetail
                        board={welcomeBoard}
                        activeView={view}
                        views={[view]}
                        cards={[welcomeCard]}
                        card={welcomeCard}
                        comments={[comment1, comment2]}
                        contents={[]}
                        attachments={[]}
                        readonly={false}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        )

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()
        expect(container).not.toBeNull()
        const tourTip = document.querySelectorAll('.AddPropertiesTourStep')
        expect(tourTip.length).toBe(2)
        expect(tourTip[1]).toMatchSnapshot()

        // moving to next step
        mockedOctoClient.patchUserConfig.mockResolvedValueOnce([])

        const nextBtn = document!.querySelector('.tipNextButton')
        expect(nextBtn).toBeDefined()
        expect(nextBtn).not.toBeNull()
        userEvent.click(nextBtn!)
        expect(mockedOctoClient.patchUserConfig).toHaveBeenCalledWith(
            'user_id_1',
            {
                updatedFields: {
                    onboardingTourStep: '1',
                },
            },
        )
    })

    // Commented out with the comments themselves (cardDetail.tsx): the list
    // is not drawn while this app has one person in it. The test comes back
    // when the feature does — docs/teamwork.md.
    /*
    test('should show add comments tour tip', async () => {
        const welcomeBoard = TestBlockFactory.createBoard()
        welcomeBoard.title = 'Welcome to Boards!'

        const welcomeCard = TestBlockFactory.createCard(welcomeBoard)
        welcomeCard.title = 'Create a new card'

        const store = mockAppStore({
            users: {
                me: {
                    id: 'user_id_1',
                },
                myConfig: {
                    welcomePageViewed: {value: '1'},
                    onboardingTourStarted: {value: true},
                    tourCategory: {value: 'card'},
                    onboardingTourStep: {value: '1'},
                },
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [welcomeBoard.id]: welcomeBoard,
                },
                current: welcomeBoard.id,
                myBoardMemberships: {
                    [welcomeBoard.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    [welcomeCard.id]: welcomeCard,
                },
                current: welcomeCard.id,
            },
            clientConfig: {
                value: {},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CardDetail
                        board={welcomeBoard}
                        activeView={view}
                        views={[view]}
                        cards={[welcomeCard]}
                        card={welcomeCard}
                        comments={[comment1, comment2]}
                        contents={[]}
                        attachments={[]}
                        readonly={false}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        )

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()
        expect(container).not.toBeNull()

        const tourTip = document.querySelectorAll('.AddCommentTourStep')
        expect(tourTip.length).toBe(2)
        expect(tourTip[1]).toMatchSnapshot()

        // moving to next step
        mockedOctoClient.patchUserConfig.mockResolvedValueOnce([])

        const nextBtn = document!.querySelector('.tipNextButton')
        expect(nextBtn).toBeDefined()
        expect(nextBtn).not.toBeNull()
        userEvent.click(nextBtn!)
        expect(mockedOctoClient.patchUserConfig).toHaveBeenCalledWith(
            'user_id_1',
            {
                updatedFields: {
                    onboardingTourStep: '2',
                },
            },
        )
    })
    */

    test('should show add description tour tip', async () => {
        const welcomeBoard = TestBlockFactory.createBoard()
        welcomeBoard.title = 'Welcome to Boards!'

        const welcomeCard = TestBlockFactory.createCard(welcomeBoard)
        welcomeCard.title = 'Create a new card'
        const state = {
            users: {
                me: {
                    id: 'user_id_1',
                },
                myConfig: {
                    welcomePageViewed: {value: '1'},
                    onboardingTourStarted: {value: true},
                    tourCategory: {value: 'card'},
                    onboardingTourStep: {value: '2'},
                },
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                boards: {
                    [welcomeBoard.id]: welcomeBoard,
                },
                current: welcomeBoard.id,
                myBoardMemberships: {
                    [welcomeBoard.id]: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    [welcomeCard.id]: welcomeCard,
                },
                current: welcomeCard.id,
            },
            clientConfig: {
                value: {},
            },
        }
        const store = mockAppStore(state)

        const text = createTextBlock()
        text.title = 'description'
        text.parentId = welcomeCard.id
        welcomeCard.fields.contentOrder = [text.id]

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapDNDIntl(() =>
                    <CardDetail
                        board={welcomeBoard}
                        activeView={view}
                        views={[view]}
                        cards={[welcomeCard]}
                        card={welcomeCard}
                        comments={[comment1, comment2]}
                        contents={[text]}
                        attachments={[]}
                        readonly={false}
                        onClose={vi.fn()}
                        onDelete={vi.fn()}
                        addAttachment={vi.fn()}
                    />,
                )}
            </AppStoreProvider>
        )

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()
        expect(container).not.toBeNull()

        const tourTip = document.querySelectorAll('.AddDescriptionTourStep')
        expect(tourTip.length).toBe(2)
        expect(tourTip[1]).toMatchSnapshot()

        // moving to next step
        mockedOctoClient.patchUserConfig.mockResolvedValueOnce([])

        const nextBtn = document!.querySelector('.tipNextButton')
        expect(nextBtn).toBeDefined()
        expect(nextBtn).not.toBeNull()
        userEvent.click(nextBtn!)
        expect(mockedOctoClient.patchUserConfig).toHaveBeenCalledWith(
            'user_id_1',
            {
                updatedFields: {
                    onboardingTourStep: '999',
                },
            },
        )
    })
})
