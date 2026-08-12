import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import NewCardButton from './newCardButton'

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)

describe('components/viewHeader/newCardButton', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
        },
        cards: {
            templates: [],
        },
        views: {
            current: 0,
            views: [activeView],
        },
    }

    const store = mockAppStore(state)
    const mockFunction = vi.fn()

    beforeEach(() => {
        vi.clearAllMocks()
    })
    test('return NewCardButton', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButton
                        board={board}
                        addCard={vi.fn()}
                        addCardTemplate={vi.fn()}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })
    test('return NewCardButton and addCard', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButton
                        board={board}
                        addCard={mockFunction}
                        addCardTemplate={vi.fn()}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonAdd = screen.getByRole('button', {name: 'Empty card'})
        userEvent.click(buttonAdd)
        expect(mockFunction).toHaveBeenCalledTimes(1)
    })
    test('return NewCardButton and addCardTemplate', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButton
                        board={board}
                        addCard={vi.fn()}
                        addCardTemplate={mockFunction}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonAddTemplate = screen.getByRole('button', {name: 'New template'})
        userEvent.click(buttonAddTemplate)
        expect(mockFunction).toHaveBeenCalledTimes(1)
    })

    // Talking a task over with an agent is a way of making cards, so it is
    // offered where cards are made rather than among the board's settings,
    // which is where it used to be and where nobody looking for it would go.
    describe('talking a task over with an agent', () => {
        const anyWindow = window as any

        const openMenu = () => {
            render(() =>
                wrapIntl(() =>
                    <AppStoreProvider store={store}>
                        <NewCardButton
                            board={board}
                            addCard={vi.fn()}
                            addCardTemplate={vi.fn()}
                            addCardFromTemplate={vi.fn()}
                            editCardTemplate={vi.fn()}
                        />
                    </AppStoreProvider>,
                ),
            )
            userEvent.click(screen.getByRole('button', {name: 'menuwrapper'}))
        }

        afterEach(() => {
            delete anyWindow.go
        })

        test('is offered beside the card templates when an agent can be opened', () => {
            anyWindow.go = {main: {App: {
                OpenPlanningTerminal: vi.fn(),
                ListTerminals: vi.fn().mockResolvedValue('[]'),
                ListAgentProjects: vi.fn().mockResolvedValue('[]'),
                ListAgents: vi.fn().mockResolvedValue('[]'),
            }}}
            openMenu()
            expect(screen.getByRole('button', {name: 'Talk it over with an agent…'})).toBeInTheDocument()
        })

        // A browser build has no CLI to open, and an entry that cannot do
        // anything is worse than no entry.
        test('is absent where there is no agent to open', () => {
            openMenu()
            expect(screen.queryByRole('button', {name: 'Talk it over with an agent…'})).toBeNull()
        })
    })
})
