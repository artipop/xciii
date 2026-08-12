import type {JSX} from 'solid-js'

import {fireEvent, render} from '@solidjs/testing-library'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import CardDetailContents from './cardDetailContents'
import {CardDetailProvider} from './cardDetailContext'

global.fetch = vi.fn()

beforeAll(() => {
    mockDOM()
})

describe('components/cardDetail/cardDetailContents', () => {
    const board = TestBlockFactory.createBoard()
    board.cardProperties = [
        {
            id: 'property_id_1',
            name: 'Owner',
            type: 'select',
            options: [
                {
                    color: 'propColorDefault',
                    id: 'property_value_id_1',
                    value: 'Jean-Luc Picard',
                },
                {
                    color: 'propColorDefault',
                    id: 'property_value_id_2',
                    value: 'William Riker',
                },
                {
                    color: 'propColorDefault',
                    id: 'property_value_id_3',
                    value: 'Deanna Troi',
                },
            ],
        },
    ]

    const card = TestBlockFactory.createCard(board)

    const state = {
        users: {
            boardUsers: {
                1: {username: 'abc'},
                2: {username: 'd'},
                3: {username: 'e'},
                4: {username: 'f'},
                5: {username: 'g'},
            },
        },
        boards: {
            boards: {
                [board.id]: board,
            },
            current: board.id,
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
    }
    const store = mockAppStore(state)
    const wrap = (child: () => JSX.Element): JSX.Element => (
        wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDetailProvider card={card}>
                    {child()}
                </CardDetailProvider>
            </AppStoreProvider>,
        )
    )

    test('should match snapshot', async () => {
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={[]}
                readonly={false}
            />
        ))

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with contents array', async () => {
        const contents = [TestBlockFactory.createDivider(card)]
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={contents}
                readonly={false}
            />
        ))

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with contents array that has array inside it', async () => {
        const contents = [TestBlockFactory.createDivider(card), [TestBlockFactory.createDivider(card), TestBlockFactory.createDivider(card)]]
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={contents}
                readonly={false}
            />
        ))
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot after drag and drop event', async () => {
        const contents = [TestBlockFactory.createDivider(card), [TestBlockFactory.createDivider(card), TestBlockFactory.createDivider(card)]]
        card.fields.contentOrder = contents.map((content) => (Array.isArray(content) ? content.map((c) => c.id) : (content as any).id))
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={contents}
                readonly={false}
            />
        ))

        const {container} = render(component)

        const drag = container!.querySelectorAll('.dnd-handle')[0]
        const drop = container!.querySelectorAll('.addToRow')[4]

        fireEvent.dragStart(drag)
        fireEvent.dragEnter(drop)
        fireEvent.dragOver(drop)
        fireEvent.drop(drop)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot after drag and drop event 2', async () => {
        const contents = [TestBlockFactory.createDivider(card), TestBlockFactory.createDivider(card)]
        card.fields.contentOrder = contents.map((content) => (Array.isArray(content) ? content.map((c) => c.id) : (content as any).id))
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={contents}
                readonly={false}
            />
        ))

        const {container} = render(component)

        const drag = container!.querySelectorAll('.dnd-handle')[0]
        const drop = container!.querySelectorAll('.addToRow')[4]

        fireEvent.dragStart(drag)
        fireEvent.dragEnter(drop)
        fireEvent.dragOver(drop)
        fireEvent.drop(drop)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot after drag and drop event 3', async () => {
        const contents = [TestBlockFactory.createDivider(card), TestBlockFactory.createDivider(card)]
        card.fields.contentOrder = contents.map((content) => (Array.isArray(content) ? content.map((c) => c.id) : (content as any).id))
        const component = () => wrap(() => (
            <CardDetailContents
                id='test-id'
                card={card}
                contents={contents}
                readonly={false}
            />
        ))

        const {container} = render(component)

        const drag = container!.querySelectorAll('.dnd-handle')[1]
        const drop = container!.querySelectorAll('.addToRow')[2]

        fireEvent.dragStart(drag)
        fireEvent.dragEnter(drop)
        fireEvent.dragOver(drop)
        fireEvent.drop(drop)

        expect(container).toMatchSnapshot()
    })
})
