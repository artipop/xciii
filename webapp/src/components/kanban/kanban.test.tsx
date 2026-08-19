import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'
import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {IPropertyOption, IPropertyTemplate} from '../../blocks/board'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {TestRouter, mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {Utils} from '../../utils'
import {mutator} from '../../mutator'

import Kanban from './kanban'

global.fetch = vi.fn()
vi.mock('../../utils')
const mockedUtils = vi.mocked(Utils)

// The spies stand in for the mutator rather than watching it: what these tests
// check is that the board was asked to change, and the real mutator would go on
// to rewrite card properties this fixture does not have. jest left a spy no-op
// after resetAllMocks, vitest restores the original implementation, which is why
// the stubs are written out here and the hooks below only clear call records.
const mockedchangePropertyOptionValue = vi.spyOn(mutator, 'changePropertyOptionValue').mockResolvedValue(undefined)
const mockedChangeViewCardOrder = vi.spyOn(mutator, 'changeViewCardOrder').mockResolvedValue(undefined)
const mockedinsertPropertyOption = vi.spyOn(mutator, 'insertPropertyOption').mockResolvedValue(undefined)

describe('src/component/kanban/kanban', () => {
    const board = TestBlockFactory.createBoard()
    const activeView = TestBlockFactory.createBoardView(board)
    const card1 = TestBlockFactory.createCard(board)
    card1.id = 'id1'
    card1.fields.properties = {id: 'property_value_id_1'}
    const card2 = TestBlockFactory.createCard(board)
    card2.id = 'id2'
    card2.fields.properties = {id: 'property_value_id_1'}
    const card3 = TestBlockFactory.createCard(board)
    card3.id = 'id3'
    card3.fields.properties = {id: 'property_value_id_2'}
    activeView.fields.kanbanCalculations = {
        id1: {
            calculation: 'countEmpty',
            propertyId: '1',

        },
    }
    const optionQ1: IPropertyOption = {
        color: 'propColorOrange',
        id: 'property_value_id_1',
        value: 'Q1',
    }
    const optionQ2: IPropertyOption = {
        color: 'propColorBlue',
        id: 'property_value_id_2',
        value: 'Q2',
    }
    const optionQ3: IPropertyOption = {
        color: 'propColorDefault',
        id: 'property_value_id_3',
        value: 'Q3',
    }

    const groupProperty: IPropertyTemplate = {
        id: 'id',
        name: 'name',
        type: 'text',
        options: [optionQ1, optionQ2],
    }

    const state = {
        users: {
            me: {
                id: 'user_id_1',
                props: {},
            },
        },
        cards: {
            cards: [card1, card2, card3],
            templates: [],
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: 'board_id_1',
            boards: {
                board_id_1: {id: 'board_id_1'},
            },
            myBoardMemberships: {
                board_id_1: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        views: {
            views: {
                boardView: activeView,
            },
            current: 'boardView',
        },
        contents: {},
        comments: {
            comments: {},
        },
    }
    const store = mockAppStore(state)
    beforeAll(() => {
        console.error = vi.fn()
        mockDOM()
    })
    beforeEach(vi.clearAllMocks)
    test('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2, card3]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        expect(container).toMatchSnapshot()
    })
    test('should match snapshot without permissions', () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={localStore}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2, card3]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        expect(container).toMatchSnapshot()
    })
    // «Входящие» is a kanban grouped by who brought the card, so its columns
    // are not places a card can be put: dropping one in another column would be
    // asking the board to have been written by somebody else. The cards do not
    // drag there, and there is no group to add.
    test('a board grouped by who made the card offers no dragging and no new group', () => {
        const byAuthor: IPropertyTemplate = {id: 'author', name: 'Автор', type: 'createdBy', options: []}
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1]}
                    groupByProperty={byAuthor}
                    visibleGroups={[{option: {id: 'user_id_1', value: 'user_id_1', color: ''}, cards: [card1]}]}
                    hiddenGroups={[]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        expect(screen.queryByText('+ Add a group')).toBeNull()
        // The card is there and opens; what it does not do is start a drag.
        expect(container.querySelector('.KanbanCard')).not.toBeNull()
        expect(container.querySelector('.KanbanCard[draggable="true"]')).toBeNull()
    })

    test('do not return a kanban with groupByProperty undefined', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={undefined}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        expect(mockedUtils.assertFailure).toHaveBeenCalled()
        expect(container).toMatchSnapshot()
    })

    // TODO(react-19): see docs/npm-dependency-warnings.md -- drives react-dnd HTML5 drag events, which dnd-kit does not listen to
    // eslint-disable-next-line no-only-tests/no-only-tests
    test.skip('return kanban and drag card to other card ', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        const cardsElement = container.querySelectorAll('.KanbanCard')
        expect(cardsElement).not.toBeNull()
        expect(cardsElement).toHaveLength(3)
        fireEvent.dragStart(cardsElement[0])
        fireEvent.dragEnter(cardsElement[1])
        fireEvent.dragOver(cardsElement[1])
        fireEvent.drop(cardsElement[1])
        expect(mockedUtils.log).toHaveBeenCalled()

        await waitFor(async () => {
            expect(mockedChangeViewCardOrder).toHaveBeenCalled()
        })
    })

    // TODO(react-19): see docs/npm-dependency-warnings.md -- drives react-dnd HTML5 drag events, which dnd-kit does not listen to
    // eslint-disable-next-line no-only-tests/no-only-tests
    test.skip('return kanban and change card column', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        const cardsElement = container.querySelectorAll('.KanbanCard')
        expect(cardsElement).not.toBeNull()
        expect(cardsElement).toHaveLength(3)
        const columnQ2Element = container.querySelector('.octo-board-column:nth-child(2)')
        expect(columnQ2Element).toBeDefined()
        fireEvent.dragStart(cardsElement[0])
        fireEvent.dragEnter(columnQ2Element!)
        fireEvent.dragOver(columnQ2Element!)
        fireEvent.drop(columnQ2Element!)
        await waitFor(async () => {
            expect(mockedChangeViewCardOrder).toHaveBeenCalled()
        })
    })

    // TODO(react-19): see docs/npm-dependency-warnings.md -- drives react-dnd HTML5 drag events, which dnd-kit does not listen to
    // eslint-disable-next-line no-only-tests/no-only-tests
    test.skip('return kanban and change card column to hidden column', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        const cardsElement = container.querySelectorAll('.KanbanCard')
        expect(cardsElement).not.toBeNull()
        expect(cardsElement).toHaveLength(3)
        const columnQ3Element = container.querySelector('.octo-board-hidden-item')
        expect(columnQ3Element).toBeDefined()
        fireEvent.dragStart(cardsElement[0]!)
        fireEvent.dragEnter(columnQ3Element!)
        fireEvent.dragOver(columnQ3Element!)
        fireEvent.drop(columnQ3Element!)
        await waitFor(async () => {
            expect(mockedChangeViewCardOrder).toHaveBeenCalled()
        })
    })
    test('return kanban and click on New', () => {
        const mockedAddCard = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={mockedAddCard}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        const allButtonsNew = screen.getAllByRole('button', {name: '+ New'})
        expect(allButtonsNew).not.toBeNull()
        userEvent.click(allButtonsNew[0])
        expect(mockedAddCard).toHaveBeenCalledTimes(1)
    })

    test('return kanban and click on KanbanCalculationMenu', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        const buttonKanbanCalculation = screen.getByRole('button', {name: '2'})
        expect(buttonKanbanCalculation).toBeDefined()
        userEvent.click(buttonKanbanCalculation!)
        expect(container).toMatchSnapshot()
    })

    test('return kanban and change title on KanbanColumnHeader', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})

        const inputTitle = screen.getByRole('textbox', {name: optionQ1.value})
        expect(inputTitle).toBeDefined()
        fireEvent.change(inputTitle, {target: {value: ''}})
        userEvent.type(inputTitle, 'New Q1')
        fireEvent.blur(inputTitle)

        await waitFor(async () => {
            expect(mockedchangePropertyOptionValue).toHaveBeenCalledWith(board.id, board.cardProperties, groupProperty, optionQ1, 'New Q1')
        })

        expect(container).toMatchSnapshot()
    })
    test('return kanban and add a group', async () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={vi.fn()}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        const buttonAddGroup = screen.getByRole('button', {name: '+ Add a group'})
        expect(buttonAddGroup).toBeDefined()
        userEvent.click(buttonAddGroup)
        await waitFor(() => {
            expect(mockedinsertPropertyOption).toHaveBeenCalled()
        })
    })
})

describe('src/component/kanban/kanban', () => {
    const board = TestBlockFactory.createBoard()
    const activeView = TestBlockFactory.createBoardView(board)
    const card1 = TestBlockFactory.createCard(board)
    card1.id = 'id1'
    card1.fields.properties = {id: 'property_value_id_1'}
    const card2 = TestBlockFactory.createCard(board)
    card2.id = 'id2'
    card2.fields.properties = {id: 'property_value_id_1'}
    const card3 = TestBlockFactory.createCard(board)
    card3.id = 'id3'
    card3.boardId = 'board_id_1'
    card3.fields.properties = {id: 'property_value_id_2'}
    activeView.fields.kanbanCalculations = {
        id1: {
            calculation: 'countEmpty',
            propertyId: '1',

        },
    }
    activeView.fields.defaultTemplateId = card3.id
    const optionQ1: IPropertyOption = {
        color: 'propColorOrange',
        id: 'property_value_id_1',
        value: 'Q1',
    }
    const optionQ2: IPropertyOption = {
        color: 'propColorBlue',
        id: 'property_value_id_2',
        value: 'Q2',
    }
    const optionQ3: IPropertyOption = {
        color: 'propColorDefault',
        id: 'property_value_id_3',
        value: 'Q3',
    }

    const groupProperty: IPropertyTemplate = {
        id: 'id',
        name: 'name',
        type: 'text',
        options: [optionQ1, optionQ2],
    }

    const state = {
        users: {
            me: {
                id: 'user_id_1',
                props: {},
            },
        },
        cards: {
            cards: [card1, card2],
            templates: [card3],
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: 'board_id_1',
            boards: {
                board_id_1: {id: 'board_id_1'},
            },
            myBoardMemberships: {
                board_id_1: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        views: {
            views: {
                boardView: activeView,
            },
            current: 'boardView',
        },
        contents: {},
        comments: {
            comments: {},
        },
    }
    const store = mockAppStore(state)
    beforeAll(() => {
        console.error = vi.fn()
        mockDOM()
    })
    beforeEach(vi.clearAllMocks)
    test('return kanban and click on New if view have already have defaultTemplateId', () => {
        const mockedAddCard = vi.fn()
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <Kanban
                    board={board}
                    activeView={activeView}
                    cards={[card1, card2]}
                    groupByProperty={groupProperty}
                    visibleGroups={[
                        {
                            option: optionQ1,
                            cards: [card1, card2],
                        }, {
                            option: optionQ2,
                            cards: [card3],
                        },
                    ]}
                    hiddenGroups={[
                        {
                            option: optionQ3,
                            cards: [],
                        },
                    ]}
                    selectedCardIds={[]}
                    readonly={false}
                    onCardClicked={vi.fn()}
                    addCard={vi.fn()}
                    addCardFromTemplate={mockedAddCard}
                    showCard={vi.fn()}
                />
            </AppStoreProvider>,
        ), {wrapper: TestRouter})
        const allButtonsNew = screen.getAllByRole('button', {name: '+ New'})
        expect(allButtonsNew).not.toBeNull()
        userEvent.click(allButtonsNew[0])
        expect(mockedAddCard).toHaveBeenCalledTimes(1)
    })
})
