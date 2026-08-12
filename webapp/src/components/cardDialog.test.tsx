import '@testing-library/jest-dom'
import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import mutator from '../mutator'
import {IUser} from '../user'
import {Utils} from '../utils'
import octoClient from '../octoClient'
import {TestBlockFactory} from '../test/testBlockFactory'
import {mockAppStore, mockDOM, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import CardDialog from './cardDialog'

vi.mock('../mutator')
vi.mock('../octoClient')
vi.mock('../utils')

// The panel beside the card is the terminal page itself. What it draws — xterm
// on a socket — is terminalPage's own test; here it only has to be the thing
// that appears, for the terminal it was given.
vi.mock('./acp/terminalPage', () => ({
    default: (props: {terminalId?: string}) => <div data-testid='terminal'>{props.terminalId}</div>,
}))

// The desktop bindings are global, and a test left holding them decides for
// every test after it whether this app has an agent integration at all.
afterEach(() => {
    delete (window as any).go
})

const mockedUtils = vi.mocked(Utils)
const mockedMutator = vi.mocked(mutator)
const mockedOctoClient = vi.mocked(octoClient)
mockedUtils.createGuid.mockReturnValue('test-id')

beforeAll(() => {
    mockDOM()
})
describe('components/cardDialog', () => {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = []
    board.id = 'test-id'
    board.teamId = 'team-id'
    const boardView = TestBlockFactory.createBoardView(board)
    boardView.id = board.id
    const card = TestBlockFactory.createCard(board)
    card.id = board.id
    card.createdBy = 'user-id-1'

    const state = {
        clientConfig: {
            value: {},
        },
        comments: {
            comments: {},
            commentsByCard: {},
        },
        contents: {
            contents: {},
            contentsByCard: {},
        },
        cards: {
            cards: {
                [card.id]: card,
            },
            current: card.id,
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
        users: {
            boardUsers: {
                1: {username: 'abc'},
                2: {username: 'd'},
                3: {username: 'e'},
                4: {username: 'f'},
                5: {username: 'g'},
            },
            blockSubscriptions: [],
        },
    }

    mockedOctoClient.searchTeamUsers.mockResolvedValue(Object.values(state.users.boardUsers) as IUser[])
    const store = mockAppStore(state)
    beforeEach(() => {
        vi.clearAllMocks()
    })
    test('should match snapshot', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot without permissions', async () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const result = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={localStore}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const container = result.container
        expect(container).toMatchSnapshot()
    })
    test('return a cardDialog readonly', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={true}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('return cardDialog and do a close action', async () => {
        const closeFn = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={closeFn}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonElement = screen.getByRole('button', {name: 'Close dialog'})
        userEvent.click(buttonElement)
        expect(closeFn).toHaveBeenCalledTimes(1)
    })
    test('return cardDialog menu content', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonMenu = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonMenu)
        expect(container).toMatchSnapshot()
    })
    test('return cardDialog menu content and verify delete action', async () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonMenu = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonMenu)
        const buttonDelete = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonDelete)

        const confirmDialog = screen.getByTitle('Confirmation dialog')
        expect(confirmDialog).toBeDefined()

        const confirmButton = screen.getByTitle('Delete')
        expect(confirmButton).toBeDefined()

        //click delete button
        userEvent.click(confirmButton!)

        // should be called once on confirming delete
        expect(mockedMutator.deleteBlock).toHaveBeenCalledTimes(1)
    })

    test('return cardDialog menu content and cancel delete confirmation do nothing', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))

        const buttonMenu = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonMenu)
        const buttonDelete = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonDelete)

        const confirmDialog = screen.getByTitle('Confirmation dialog')
        expect(confirmDialog).toBeDefined()

        const cancelButton = screen.getByTitle('Cancel')
        expect(cancelButton).toBeDefined()

        //click delete button
        userEvent.click(cancelButton!)

        // should do nothing  on cancel delete dialog
        expect(container).toMatchSnapshot()
    })

    test('return cardDialog menu content and do a New template from card', async () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonMenu = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonMenu)
        const buttonTemplate = screen.getByRole('button', {name: 'New template from card'})
        userEvent.click(buttonTemplate)
        expect(mockedMutator.duplicateCard).toHaveBeenCalledTimes(1)
    })

    test('return cardDialog menu content and do a copy Link', async () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonMenu = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonMenu)
        const buttonCopy = screen.getByRole('button', {name: 'Copy link'})
        userEvent.click(buttonCopy)
        expect(mockedUtils.copyTextToClipboard).toHaveBeenCalledTimes(1)
    })

    test('already following card', async () => {
        // simply doing {...state} gives a TypeScript error
        // when you try updating it's values.
        const newState = JSON.parse(JSON.stringify(state))
        newState.users.blockSubscriptions = [{blockId: card.id}]
        newState.clientConfig = {
            value: {},
        }

        const newStore = mockAppStore(newState)

        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={newStore}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('limited card shows hidden view (no toolbar)', async () => {
        // simply doing {...state} gives a TypeScript error
        // when you try updating it's values.
        const newState = JSON.parse(JSON.stringify(state))
        const limitedCard = {...card, limited: true}
        newState.cards = {
            cards: {
                [limitedCard.id]: limitedCard,
            },
            current: limitedCard.id,
        }

        const newStore = mockAppStore(newState)

        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={newStore}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[limitedCard]}
                    cardId={limitedCard.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    // A board of household chores is a board. The agent integration being
    // compiled in is not a reason to offer a terminal on a machine that has
    // nobody to open one with.
    it('offers no terminal on a machine where no agent is registered', async () => {
        const bindings = {
            GetCardAgent: vi.fn().mockResolvedValue('{}'),
            OpenCardTerminal: vi.fn(),
            ListAgentAccounts: vi.fn().mockResolvedValue('[]'),
        };
        (window as any).go = {main: {App: bindings}}

        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))

        await waitFor(() => expect(bindings.ListAgentAccounts).toHaveBeenCalled())
        expect(screen.queryByRole('button', {name: 'Terminal'})).toBeNull()
    })

    // The terminal is beside the card rather than in it: the card is what a
    // person wrote, and the dialog's toolbar is where the machinery lives.
    it('opens the terminal in a panel beside the card', async () => {
        const bindings = {
            // The card resolves a folder, so the panel starts straight away
            // rather than asking where the conversation should live.
            GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify({folder: '/tmp/proj'})),
            OpenCardTerminal: vi.fn().mockResolvedValue(JSON.stringify({id: 'term-7'})),
            ListAgentAccounts: vi.fn().mockResolvedValue(JSON.stringify([{name: 'claude', username: 'claude'}])),
        };
        (window as any).go = {main: {App: bindings}}

        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDialog
                    board={board}
                    activeView={boardView}
                    views={[boardView]}
                    cards={[card]}
                    cardId={card.id}
                    onClose={vi.fn()}
                    showCard={vi.fn()}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))

        await userEvent.click(await screen.findByRole('button', {name: 'Terminal'}))

        // The panel asks Go for this card's terminal as it opens: opening it is
        // the whole request, and there is nothing else in it to look at first.
        await waitFor(() => expect(bindings.OpenCardTerminal).toHaveBeenCalledWith(card.id, '', '', false))
        expect(await screen.findByTestId('terminal')).toHaveTextContent('term-7')
        expect(container.querySelector('.cardDialog__side')).not.toBeNull()

        await userEvent.click(screen.getByRole('button', {name: 'Close the panel'}))
        expect(container.querySelector('.cardDialog__side')).toBeNull()
    })
})
