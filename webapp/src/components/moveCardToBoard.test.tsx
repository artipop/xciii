import '@testing-library/jest-dom'
import {fireEvent, render, screen} from '@solidjs/testing-library'

import {TestBlockFactory} from '../test/testBlockFactory'
import {mockAppStore, mockDOM, wrapIntl} from '../testUtils'
import {AppStoreProvider} from '../store'
import mutator from '../mutator'

import MoveCardToBoard, {openMoveCardToBoard} from './moveCardToBoard'

beforeAll(() => {
    mockDOM()
})

beforeEach(() => {
    vi.clearAllMocks()
})

describe('components/moveCardToBoard', () => {
    const home = TestBlockFactory.createBoard()
    home.id = 'board-home'
    home.title = 'Входящие'

    const work = TestBlockFactory.createBoard()
    work.id = 'board-work'
    work.title = 'Разработка'
    work.cardProperties = [{
        id: 'work-status',
        name: 'Статус',
        type: 'select',
        options: [
            {id: 'work-todo', value: 'Не начата', color: ''},
            {id: 'work-doing', value: 'В работе', color: ''},
        ],
    }]

    const card = TestBlockFactory.createCard(home)
    card.id = 'card-1'
    card.title = 'Доставка приедет завтра'

    const state = {
        boards: {
            current: home.id,
            boards: {[home.id]: home, [work.id]: work},
            templates: {},
            myBoardMemberships: {
                [home.id]: {userId: 'user_id_1', schemeAdmin: true},
                [work.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        cards: {
            cards: {[card.id]: card},
            templates: {},
        },
        teams: {current: {id: 'team-id'}},
        users: {me: {id: 'user_id_1'}},
    }

    const open = () => {
        const store = mockAppStore(state)
        openMoveCardToBoard(card.id)
        return render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <MoveCardToBoard/>
            </AppStoreProvider>,
        ))
    }

    // The board the card is already on is not somewhere to move it to.
    test('offers every board but the one the card is on', () => {
        open()

        expect(screen.getByText('Разработка')).toBeInTheDocument()
        expect(screen.queryByText('Входящие')).not.toBeInTheDocument()
    })

    // Picking the column is the second half of the same gesture: the card is
    // moved and dropped into a column of the board it arrived on.
    test('moves the card into the column picked on the new board', async () => {
        const move = vi.spyOn(mutator, 'moveCardToBoard').mockResolvedValue(card)
        open()

        fireEvent.click(screen.getByText('Разработка'))
        fireEvent.click(await screen.findByText('В работе'))

        expect(move).toHaveBeenCalledWith(card, work.id, 'work-status', 'work-doing')
    })

    // Moving without naming a column is a real answer: a column of the same
    // name on the new board keeps the card where it stood.
    test('moves the card without a column when none is picked', async () => {
        const move = vi.spyOn(mutator, 'moveCardToBoard').mockResolvedValue(card)
        open()

        fireEvent.click(screen.getByText('Разработка'))
        fireEvent.click(await screen.findByText('Just move it'))

        expect(move).toHaveBeenCalledWith(card, work.id, 'work-status', undefined)
    })
})
