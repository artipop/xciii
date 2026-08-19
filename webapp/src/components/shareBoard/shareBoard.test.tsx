import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {IUser} from '../../user'
import {ISharing} from '../../blocks/sharing'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {TestRouter, mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import client from '../../octoClient'
import {Utils} from '../../utils'

import ShareBoard from './shareBoard'

vi.useFakeTimers()

const boardId = '1'
const workspaceId: string|undefined = boardId
const viewId = boardId

vi.mock('../../octoClient')
vi.mock('../../utils')

const mockedOctoClient = vi.mocked(client)
const mockedUtils = vi.mocked(Utils)

let mockRouteParams: Record<string, string> = {}
vi.mock('../../hooks/routerMatch', () => ({
    useRouteMatch: () => () => ({
        path: '/',
        params: mockRouteParams,
    }),
}))

const board = TestBlockFactory.createBoard()
board.id = boardId
board.teamId = 'team-id'
board.cardProperties = [
    {
        id: 'property1',
        name: 'Property 1',
        type: 'text',
        options: [
            {
                id: 'value1',
                value: 'value 1',
                color: 'propColorBrown',
            },
        ],
    },
    {
        id: 'property2',
        name: 'Property 2',
        type: 'select',
        options: [
            {
                id: 'value2',
                value: 'value 2',
                color: 'propColorBlue',
            },
        ],
    },
]

const activeView = TestBlockFactory.createBoardView(board)
activeView.id = 'view1'
activeView.fields.hiddenOptionIds = []
activeView.fields.visiblePropertyIds = ['property1']
activeView.fields.visibleOptionIds = ['value1']

const fakeBoard = {id: board.id}
activeView.boardId = fakeBoard.id

const card1 = TestBlockFactory.createCard(board)
card1.id = 'card1'
card1.title = 'card-1'
card1.boardId = fakeBoard.id

const card2 = TestBlockFactory.createCard(board)
card2.id = 'card2'
card2.title = 'card-2'
card2.boardId = fakeBoard.id

const card3 = TestBlockFactory.createCard(board)
card3.id = 'card3'
card3.title = 'card-3'
card3.boardId = fakeBoard.id

const me: IUser = {
    id: 'user-id-1',
    username: 'username_1',
    email: '',
    nickname: '',
    firstname: '',
    lastname: '',
    props: {},
    create_at: 0,
    update_at: 0,
    is_bot: false,
    is_guest: false,
    roles: 'system_user',
}

const categoryAttribute1 = TestBlockFactory.createCategoryBoards()
categoryAttribute1.name = 'Category 1'
categoryAttribute1.boardMetadata = [{boardID: board.id, hidden: false}]

describe('src/components/shareBoard/shareBoard', () => {
    const w = (window as any)
    const oldBaseURL = w.baseURL

    const state = {
        teams: {
            current: {id: 'team-id', title: 'Test Team'},
        },
        users: {
            me,
            boardUsers: {[me.id]: me},
            blockSubscriptions: [],
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            templates: [],
            membersInBoards: {
                [board.id]: {},
            },
            myBoardMemberships: {
                [board.id]: {userId: me.id, schemeAdmin: true},
            },
        },
        globalTemplates: {
            value: [],
        },
        views: {
            views: {
                [activeView.id]: activeView,
            },
            current: activeView.id,
        },
        cards: {
            templates: [],
            cards: [card1, card2, card3],
        },
        searchText: {},
        clientConfig: {
            value: {
                enablePublicSharedBoards: true,
                teammateNameDisplay: 'username',
            },
        },
        contents: {
            contents: {},
        },
        comments: {
            comments: {},
        },
        sidebar: {
            categoryAttributes: [
                categoryAttribute1,
            ],
        },
    }

    const store = mockAppStore(state)
    beforeEach(() => {
        vi.clearAllMocks()
        mockedUtils.buildURL.mockImplementation((path) => (w.baseURL || '') + path)

        mockRouteParams = {
            boardId,
            viewId,
            workspaceId,
        }
    })

    afterEach(() => {
        w.baseURL = oldBaseURL
    })

    test('should match snapshot', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()
        const shareButton = screen.getByRole('button', {name: 'Share'})
        expect(shareButton).toBeDefined()
        const closeButton = screen.getByRole('button', {name: 'Close dialog'})
        expect(closeButton).toBeDefined()
    })

    test('should match snapshot with sharing', async () => {
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const copyLinkElement = screen.getByTitle('Copy link')
        expect(copyLinkElement).toBeDefined()

        expect(container).toMatchSnapshot()
    })

    test('return shareBoard and click Copy link', async () => {
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()

        const copyLinkElement = screen.getByTitle('Copy link')
        expect(copyLinkElement).toBeDefined()

        userEvent.click(copyLinkElement!)

        expect(mockedUtils.copyTextToClipboard).toHaveBeenCalledTimes(1)
        expect(container).toMatchSnapshot()

        const copiedLinkElement = screen.getByText('Copied!')
        expect(copiedLinkElement).toBeDefined()
    })

    test('return shareBoard and click Regenerate token', async () => {
        window.confirm = vi.fn(() => {
            return true
        })
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        sharing.token = 'anotherToken'
        mockedUtils.createGuid.mockReturnValue('anotherToken')
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        mockedOctoClient.setSharing.mockResolvedValue(true)

        const publishButton = screen.getByRole('button', {name: 'Publish'})
        expect(publishButton).toBeDefined()
        userEvent.click(publishButton)
        vi.runOnlyPendingTimers()

        const regenerateTokenElement = await screen.findByRole('button', {name: 'Regenerate token'})
        expect(regenerateTokenElement).toBeDefined()
        userEvent.click(regenerateTokenElement)
        vi.runOnlyPendingTimers()
        expect(mockedOctoClient.setSharing).toHaveBeenCalledTimes(1)
        expect(container).toMatchSnapshot()
    })

    test('return shareBoard, and click switch', async () => {
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const container = result.container

        const publishButton = screen.getByRole('button', {name: 'Publish'})
        expect(publishButton).toBeDefined()
        userEvent.click(publishButton)
        vi.runOnlyPendingTimers()

        const switchElement = container?.querySelector('.Switch')
        expect(switchElement).toBeDefined()
        userEvent.click(switchElement!)

        expect(mockedOctoClient.setSharing).toHaveBeenCalledTimes(1)

        // the re-read after the toggle sits behind the awaited setSharing
        await waitFor(() => expect(mockedOctoClient.getSharing).toHaveBeenCalledTimes(2))
        expect(container).toMatchSnapshot()
    })

    // TODO(react-19): see docs/npm-dependency-warnings.md -- asserted on a race: React 17 clicked before getSharing resolved
    // eslint-disable-next-line no-only-tests/no-only-tests
    test.skip('return shareBoardComponent and click Switch without sharing', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        mockedUtils.createGuid.mockReturnValue('aToken')
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )
        const container = result.container
        mockedOctoClient.getSharing.mockResolvedValue({
            id: boardId,
            enabled: true,
            token: 'aToken',
        })

        // React 19 commits when the act callback returns, so the rendered tree
        // is only queryable from a second one.
        const publishButton = screen.getByRole('button', {name: 'Publish'})
        expect(publishButton).toBeDefined()
        userEvent.click(publishButton)
        vi.runOnlyPendingTimers()

        // The switch only exists once publishing has committed.
        const switchElement = container?.querySelector('.Switch')
        expect(switchElement).toBeDefined()
        userEvent.click(switchElement!)
        vi.runOnlyPendingTimers()
        result?.rerender(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>))

        expect(mockedOctoClient.setSharing).toHaveBeenCalledTimes(1)

        // the re-read after the toggle sits behind the awaited setSharing
        await waitFor(() => expect(mockedOctoClient.getSharing).toHaveBeenCalledTimes(2))
        expect(mockedUtils.createGuid).toHaveBeenCalledTimes(1)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with sharing and without workspaceId and subpath', async () => {
        w.baseURL = '/test-subpath/plugins/boards'
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockRouteParams = {
            boardId,
            viewId,
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <ShareBoard
                    onClose={vi.fn()}
                    enableSharedBoards={true}
                />
            </AppStoreProvider>),
        {wrapper: TestRouter})
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with sharing and subpath', async () => {
        w.baseURL = '/test-subpath/plugins/boards'
        const sharing: ISharing = {
            id: boardId,
            enabled: true,
            token: 'oneToken',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <ShareBoard
                    onClose={vi.fn()}
                    enableSharedBoards={true}
                />
            </AppStoreProvider>),
        {wrapper: TestRouter})
        expect(container).toMatchSnapshot()
    })

    test('return shareBoard and click Select', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        mockedUtils.getUserDisplayName.mockImplementation((u) => u.username)

        const users: IUser[] = [
            {id: 'userid1', username: 'username_1'} as IUser,
            {id: 'userid2', username: 'username_2'} as IUser,
            {id: 'userid3', username: 'username_3'} as IUser,
            {id: 'userid4', username: 'username_4'} as IUser,
        ]
        mockedOctoClient.searchTeamUsers.mockResolvedValue(users)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={false}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()
        const selectElement = await screen.findByText('Search for people')
        expect(selectElement).toBeDefined()

        userEvent.click(selectElement!)

        expect(container).toMatchSnapshot()
    })

    test('return shareBoard and click Select, non-plugin mode', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        const users: IUser[] = [
            {id: 'userid1', username: 'username_1', permissions: ['manage_team']} as IUser,
            {id: 'userid2', username: 'username_2', permissions: ['manage_system']} as IUser,
            {id: 'userid3', username: 'username_3'} as IUser,
            {id: 'userid4', username: 'username_4'} as IUser,
        ]
        mockedOctoClient.searchTeamUsers.mockResolvedValue(users)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={false}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()
        const selectElement = await screen.findByText('Search for people')
        expect(selectElement).toBeDefined()

        userEvent.click(selectElement!)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, with template', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)

        const templateBoard = {...board, isTemplate: true}
        const myStore = mockAppStore({
            ...state,
            boards: {
                ...state.boards,
                boards: {[board.id]: templateBoard},
            },
        } as any)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={myStore}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()
        const closeButton = screen.getByRole('button', {name: 'Close dialog'})
        expect(closeButton).toBeDefined()
    })

    test('return shareBoard template and click Select', async () => {
        const sharing: ISharing = {
            id: '',
            enabled: false,
            token: '',
        }
        mockedOctoClient.getSharing.mockResolvedValue(sharing)
        mockedUtils.getUserDisplayName.mockImplementation((u) => u.username)

        const users: IUser[] = [
            {id: 'userid1', username: 'username_1'} as IUser,
            {id: 'userid2', username: 'username_2'} as IUser,
            {id: 'userid3', username: 'username_3'} as IUser,
            {id: 'userid4', username: 'username_4'} as IUser,
        ]
        mockedOctoClient.searchTeamUsers.mockResolvedValue(users)

        const templateBoard = {...board, isTemplate: true}
        const myStore = mockAppStore({
            ...state,
            boards: {
                ...state.boards,
                boards: {[board.id]: templateBoard},
            },
        } as any)

        const {container} = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={myStore}>
                    <ShareBoard
                        onClose={vi.fn()}
                        enableSharedBoards={false}
                    />
                </AppStoreProvider>),
        {wrapper: TestRouter},
        )

        expect(container).toMatchSnapshot()
        const selectElement = await screen.findByText('Search for people')
        expect(selectElement).toBeDefined()

        userEvent.click(selectElement!)

        expect(container).toMatchSnapshot()
    })
})
