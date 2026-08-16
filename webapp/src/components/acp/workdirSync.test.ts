import mutator from '../../mutator'
import {TestBlockFactory} from '../../test/testBlockFactory'
import {Card} from '../../blocks/card'

import {narrowWorkdirProperty} from './workdirSync'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

// A board as it was made before the folder field became a single choice.
const boardWithOldField = (name = 'Папки') => {
    const board = TestBlockFactory.createBoard()
    board.cardProperties.push({
        id: 'projectprop',
        name,
        type: 'multiSelect',
        options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
    })
    board.properties = {...board.properties, xciiiProjectProperty: 'projectprop'}
    return board
}

describe('components/acp/workdirSync', () => {
    afterEach(() => vi.clearAllMocks())

    // A card works in one folder: one workspace, one branch, one cwd. While the
    // field allowed several, the second value was not a second folder — the
    // engine took whichever the board listed first — so the field is narrowed
    // and the choice becomes something a person can see and change.
    test('makes the folder field a single choice on a board that predates it', async () => {
        const board = boardWithOldField()
        const cards: Card[] = []

        expect(await narrowWorkdirProperty(board, cards)).toBe(true)

        const [, , property, type, name] = mockedMutator.changePropertyTypeAndName.mock.calls[0]
        expect(property.id).toBe('projectprop')
        expect(type).toBe('select')

        // The plural was the type talking, so the name goes with it.
        expect(name).toBe('Папка')
    })

    // The name is the one half of the field that can be somebody's own, and
    // renaming it under them would be editing their board rather than
    // finishing ours.
    test('keeps a name the board owner gave the field', async () => {
        const board = boardWithOldField('Репозитории')

        expect(await narrowWorkdirProperty(board, [])).toBe(true)
        expect(mockedMutator.changePropertyTypeAndName.mock.calls[0][4]).toBe('Репозитории')
    })

    // This runs every time a board is opened, so a board that has already been
    // through it must be left alone: a write here is an entry in the undo
    // history and a message on the websocket for everybody looking.
    test('writes nothing to a board whose field is already a single choice', async () => {
        const board = TestBlockFactory.createBoard()
        board.cardProperties.push({
            id: 'projectprop',
            name: 'Папка',
            type: 'select',
            options: [{id: 'o1', value: 'alpha', color: 'propColorDefault'}],
        })
        board.properties = {...board.properties, xciiiProjectProperty: 'projectprop'}

        expect(await narrowWorkdirProperty(board, [])).toBe(false)
        expect(mockedMutator.changePropertyTypeAndName).not.toHaveBeenCalled()
    })

    // Nothing is recognised by what it is called: a board that never had a
    // folder field has multiSelects of its own — tags, labels — and none of
    // them is this one.
    test('leaves a board that has no folder field alone', async () => {
        const board = TestBlockFactory.createBoard()
        board.cardProperties.push({
            id: 'tags-prop',
            name: 'Метки',
            type: 'multiSelect',
            options: [{id: 'o1', value: 'срочно', color: 'propColorDefault'}],
        })

        expect(await narrowWorkdirProperty(board, [])).toBe(false)
        expect(mockedMutator.changePropertyTypeAndName).not.toHaveBeenCalled()
    })
})
