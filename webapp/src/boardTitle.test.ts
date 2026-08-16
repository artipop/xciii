import {titleTaken} from './boardTitle'

// Two boards a person cannot tell apart in the sidebar are two boards with the
// same name, whatever the bytes say — so the comparison is trimmed and
// case-insensitive.
describe('boardTitle', () => {
    const boards = [
        {id: 'board-1', title: 'Разработка'},
        {id: 'board-2', title: 'Домашние дела'},
        {id: 'template-1', title: 'Контент', isTemplate: true},
    ]

    test('a name another board has is taken', () => {
        expect(titleTaken(boards, 'Разработка', 'board-3')).toBe(true)
        expect(titleTaken(boards, '  разработка ', 'board-3')).toBe(true)
    })

    test('a board does not take its own name', () => {
        expect(titleTaken(boards, 'Разработка', 'board-1')).toBe(false)
    })

    test('a free name is free, and an empty one is not an answer to check', () => {
        expect(titleTaken(boards, 'Ремонт кухни', 'board-3')).toBe(false)
        expect(titleTaken(boards, '   ', 'board-3')).toBe(false)
    })

    // A template is not in the sidebar's list of boards, and every board made
    // from «Контент» would otherwise have to be called something else.
    test('templates do not take a name from a board', () => {
        expect(titleTaken(boards, 'Контент', 'board-3')).toBe(false)
    })
})
