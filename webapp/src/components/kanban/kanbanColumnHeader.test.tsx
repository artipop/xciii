import {fireEvent, render, screen, within} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {createIntl} from '../../intl'

import Mutator from '../../mutator'
import {mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {IPropertyOption, IPropertyTemplate} from '../../blocks/board'

import KanbanColumnHeader from './kanbanColumnHeader'
vi.mock('../../mutator')
const mockedMutator = vi.mocked(Mutator)
describe('src/components/kanban/kanbanColumnHeader', () => {
    const intl = createIntl({locale: 'en-us'})
    const board = TestBlockFactory.createBoard()
    const activeView = TestBlockFactory.createBoardView(board)
    const card = TestBlockFactory.createCard(board)
    card.id = 'id1'
    activeView.fields.kanbanCalculations = {
        id1: {
            calculation: 'countEmpty',
            propertyId: '1',

        },
    }
    const option: IPropertyOption = {
        id: 'id1',
        value: 'Title',
        color: 'propColorDefault',
    }
    const state = {
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
    }
    const store = mockAppStore(state)
    beforeAll(() => {
        console.error = vi.fn()
    })
    beforeEach(vi.resetAllMocks)
    test('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot readonly', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={true}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })
    test('return kanbanColumnHeader and edit title', () => {
        const mockedPropertyNameChanged = vi.fn()
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={mockedPropertyNameChanged}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const inputTitle = screen.getByRole('textbox', {name: option.value})
        expect(inputTitle).toBeDefined()
        fireEvent.change(inputTitle, {target: {value: ''}})
        userEvent.type(inputTitle, 'New Title')
        fireEvent.blur(inputTitle)
        expect(mockedPropertyNameChanged).toHaveBeenCalledWith(option, 'New Title')
        expect(container).toMatchSnapshot()
    })
    test('return kanbanColumnHeader and click on menuwrapper', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonMenuWrapper = screen.getByRole('button', {name: 'menuwrapper'})
        expect(buttonMenuWrapper).toBeDefined()
        userEvent.click(buttonMenuWrapper)
        expect(container).toMatchSnapshot()
    })
    test('return kanbanColumnHeader, click on menuwrapper and click on hide menu', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonMenuWrapper = screen.getByRole('button', {name: 'menuwrapper'})
        expect(buttonMenuWrapper).toBeDefined()
        userEvent.click(buttonMenuWrapper)
        const buttonHide = within(buttonMenuWrapper).getByRole('button', {name: 'Hide'})
        expect(buttonHide).toBeDefined()
        userEvent.click(buttonHide)
        expect(mockedMutator.hideViewColumn).toHaveBeenCalledTimes(1)
    })
    test('return kanbanColumnHeader, click on menuwrapper and click on delete menu', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonMenuWrapper = screen.getByRole('button', {name: 'menuwrapper'})
        expect(buttonMenuWrapper).toBeDefined()
        userEvent.click(buttonMenuWrapper)
        const buttonDelete = within(buttonMenuWrapper).getByRole('button', {name: 'Delete'})
        expect(buttonDelete).toBeDefined()
        userEvent.click(buttonDelete)
        expect(mockedMutator.deletePropertyOption).toHaveBeenCalledTimes(1)
    })
    test('return kanbanColumnHeader, click on menuwrapper and click on blue color menu', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonMenuWrapper = screen.getByRole('button', {name: 'menuwrapper'})
        expect(buttonMenuWrapper).toBeDefined()
        userEvent.click(buttonMenuWrapper)
        const buttonBlueColor = within(buttonMenuWrapper).getByRole('button', {name: 'Select Blue Color'})
        expect(buttonBlueColor).toBeDefined()
        userEvent.click(buttonBlueColor)
        expect(mockedMutator.changePropertyOptionColor).toHaveBeenCalledTimes(1)
    })

    test('return kanbanColumnHeader and click to add card', () => {
        const mockedAddCard = vi.fn()
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={mockedAddCard}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonAddCard = container.querySelector('.AddIcon')?.parentElement
        expect(buttonAddCard).toBeDefined()
        userEvent.click(buttonAddCard!)
        expect(mockedAddCard).toHaveBeenCalledTimes(1)
    })
    test('return kanbanColumnHeader and click KanbanCalculationMenu', () => {
        const mockedCalculationMenuOpen = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={mockedCalculationMenuOpen}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const buttonKanbanCalculation = screen.getByText(/0/i).parentElement
        expect(buttonKanbanCalculation).toBeDefined()
        userEvent.click(buttonKanbanCalculation!)
        expect(mockedCalculationMenuOpen).toHaveBeenCalledTimes(1)
    })
    test('return kanbanColumnHeader and click count on KanbanCalculationMenu', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <KanbanColumnHeader
                    board={board}
                    activeView={activeView}
                    group={{
                        option,
                        cards: [card],
                    }}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={true}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))
        const menuCountEmpty = screen.getByText('Count')
        expect(menuCountEmpty).toBeDefined()
        userEvent.click(menuCountEmpty)
        expect(mockedMutator.changeViewKanbanCalculations).toHaveBeenCalledTimes(1)
    })

    // The inbox's columns say who brought the card; what the person themselves
    // brought is their unprocessed tasks, so their own column is headed by what
    // the cards are — «Мои задачи» — and everybody else's by who they are.
    describe('a person group on the inbox view', () => {
        const inboxView = TestBlockFactory.createBoardView(board)
        inboxView.title = 'Входящие'
        const byAuthor = {id: 'author-prop', name: 'Автор', type: 'createdBy', options: []} as unknown as IPropertyTemplate
        const meUser = {id: 'single-user', username: 'Вы'}
        const sourceUser = {id: 'kaiten', username: 'kaiten'}
        const storeWithUsers = mockAppStore({
            ...state,
            users: {
                me: meUser,
                boardUsers: {'single-user': meUser, kaiten: sourceUser},
            },
        } as never)

        const renderHeader = (view: typeof inboxView, groupID: string) => render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={storeWithUsers}>
                <KanbanColumnHeader
                    board={board}
                    activeView={view}
                    group={{
                        option: {id: groupID, value: '', color: ''},
                        cards: [],
                    }}
                    groupByProperty={byAuthor}
                    intl={intl}
                    readonly={false}
                    addCard={vi.fn()}
                    propertyNameChanged={vi.fn()}
                    onDropToColumn={vi.fn()}
                    calculationMenuOpen={false}
                    onCalculationMenuOpen={vi.fn()}
                    onCalculationMenuClose={vi.fn()}
                />
            </AppStoreProvider>,
        ))

        test('the viewer\'s own column is headed «Мои задачи»', () => {
            renderHeader(inboxView, 'single-user')
            expect(screen.getByText('Мои задачи')).toBeInTheDocument()
        })

        test('a source\'s column is headed by the source', () => {
            renderHeader(inboxView, 'kaiten')
            expect(screen.getByText('kaiten')).toBeInTheDocument()
        })

        test('outside the inbox the viewer stays themselves', () => {
            renderHeader(activeView, 'single-user')
            expect(screen.getByText('Вы')).toBeInTheDocument()
            expect(screen.queryByText('Мои задачи')).toBeNull()
        })
    })
})
