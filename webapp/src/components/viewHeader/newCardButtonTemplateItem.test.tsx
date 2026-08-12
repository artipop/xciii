import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import mutator from '../../mutator'

import NewCardButtonTemplateItem from './newCardButtonTemplateItem'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)
const card = TestBlockFactory.createCard(board)

describe('components/viewHeader/newCardButtonTemplateItem', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: {id: board.id},
            },
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
    test('return NewCardButtonTemplateItem', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButtonTemplateItem
                        cardTemplate={card}
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
    test('return NewCardButtonTemplateItem and edit', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButtonTemplateItem
                        cardTemplate={card}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={mockFunction}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonEdit = screen.getByRole('button', {name: 'Edit'})
        userEvent.click(buttonEdit)
        expect(mockFunction).toHaveBeenCalledTimes(1)
        expect(mockFunction).toHaveBeenCalledWith(card.id)
    })

    test('return NewCardButtonTemplateItem and add Card from template', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButtonTemplateItem
                        cardTemplate={card}
                        addCardFromTemplate={mockFunction}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonAdd = screen.getByRole('button', {name: 'title'})
        userEvent.click(buttonAdd)
        expect(container).toMatchSnapshot()
        expect(mockFunction).toHaveBeenCalledTimes(1)
    })
    test('return NewCardButtonTemplateItem and delete', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButtonTemplateItem
                        cardTemplate={card}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonDelete = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonDelete)
        expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
    })
    test('return NewCardButtonTemplateItem and Set as default', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <NewCardButtonTemplateItem
                        cardTemplate={card}
                        addCardFromTemplate={vi.fn()}
                        editCardTemplate={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonSetAsDefault = screen.getByRole('button', {name: 'Set as default'})
        userEvent.click(buttonSetAsDefault)
        expect(mockedMutator.setDefaultTemplate).toHaveBeenCalledTimes(1)
        expect(mockedMutator.setDefaultTemplate).toHaveBeenCalledWith(activeView.boardId, activeView.id, activeView.fields.defaultTemplateId, card.id)
    })
})
