import mutator from './mutator'
import {TestBlockFactory} from './test/testBlockFactory'
import 'isomorphic-fetch'
import {FetchMock} from './test/fetchMock'
import {mockDOM} from './testUtils'

global.fetch = FetchMock.fn

beforeEach(() => {
    FetchMock.fn.mockReset()
})

beforeAll(() => {
    mockDOM()
})

describe('Mutator', () => {
    test('changePropertyValue', async () => {
        const board = TestBlockFactory.createBoard()
        const card = TestBlockFactory.createCard()
        card.boardId = board.id
        card.fields.properties.property_1 = 'hello'

        await mutator.changePropertyValue(board.id, card, 'property_1', 'hello')

        // No API call should be made as property value DIDN'T CHANGE
        expect(FetchMock.fn).toHaveBeenCalledTimes(0)

        await mutator.changePropertyValue(board.id, card, 'property_1', 'hello world')

        // 1 API call should be made as property value DID CHANGE
        expect(FetchMock.fn).toHaveBeenCalledTimes(1)
    })

    test('duplicateCard', async () => {
        const board = TestBlockFactory.createBoard()
        const card = TestBlockFactory.createCard(board)

        FetchMock.fn.mockReturnValueOnce(FetchMock.jsonResponse(JSON.stringify([card])))
        const [newBlocks, newCardID] = await mutator.duplicateCard(card.id, board.id)

        expect(newBlocks).toHaveLength(1)

        const duplicatedCard = newBlocks[0]
        expect(duplicatedCard.type).toBe('card')
        expect(duplicatedCard.id).toBe(newCardID)
        expect(duplicatedCard.fields.icon).toBe(card.fields.icon)
        expect(duplicatedCard.fields.contentOrder).toHaveLength(card.fields.contentOrder.length)
        expect(duplicatedCard.boardId).toBe(board.id)
    })

    // Narrowing a multiSelect to a select keeps the options and leaves every
    // card with the first of the values it had. The folder field is converted
    // this way on boards made before it became a single choice
    // (narrowWorkdirProperty), and the whole safety of that migration is here:
    // a conversion that emptied the options would take away every folder the
    // board offers and every card's answer with them.
    test('changePropertyTypeAndName from multiSelect to select keeps the options and the first value', async () => {
        const board = TestBlockFactory.createBoard()
        const property = {
            id: 'folders',
            name: 'Папки',
            type: 'multiSelect' as const,
            options: [
                {id: 'alpha', value: 'alpha', color: 'propColorDefault'},
                {id: 'beta', value: 'beta', color: 'propColorDefault'},
            ],
        }
        board.cardProperties = [property]

        const card = TestBlockFactory.createCard(board)
        card.fields.properties.folders = ['beta', 'alpha']

        await mutator.changePropertyTypeAndName(board, [card], property, 'select', 'Папка')

        const patch = JSON.parse(FetchMock.fn.mock.calls[0][1].body)
        const newProperty = patch.boardPatches[0].updatedCardProperties.
            find((p: {id: string}) => p.id === 'folders')
        expect(newProperty.type).toBe('select')
        expect(newProperty.name).toBe('Папка')
        expect(newProperty.options.map((o: {id: string}) => o.id)).toEqual(['alpha', 'beta'])
        expect(patch.blockPatches[0].updatedFields.properties.folders).toBe('beta')
    })
})
