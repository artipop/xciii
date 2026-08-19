import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'

import {personProperty, waitAudience, waitIsMine} from './attentionAudience'

const property = (id: string, type: string, name = 'Кто занимается'): IPropertyTemplate => ({
    id,
    name,
    type,
    options: [],
} as unknown as IPropertyTemplate)

const board = (props: IPropertyTemplate[]): Board => ({cardProperties: props} as Board)

const card = (properties: Record<string, string | string[]>): Card => ({
    fields: {properties},
} as unknown as Card)

describe('components/acp/attentionAudience', () => {
    // The same rule the Go side follows: the field is found by its type,
    // because this app names it «Кто занимается» and a person may call it
    // anything.
    it('finds who a card belongs to by the field type, never by its name', () => {
        const found = personProperty(board([
            property('p1', 'text', 'Person'),
            property('p2', 'person', 'Ответственный'),
        ]))
        expect(found?.id).toBe('p2')
    })

    it('takes the first person field where a board has two', () => {
        const found = personProperty(board([property('a', 'multiPerson'), property('b', 'person')]))
        expect(found?.id).toBe('a')
    })

    it('reads the assignee off the card, single or multiple', () => {
        const one = board([property('who', 'person')])
        expect(waitAudience(card({who: 'user-1'}), one)).toEqual(['user-1'])

        const many = board([property('who', 'multiPerson')])
        expect(waitAudience(card({who: ['user-1', 'user-2']}), many)).toEqual(['user-1', 'user-2'])
    })

    // A card assigned to an agent — the ordinary case — names no person, and a
    // wait nobody would be told about is a wait nobody answers.
    it('names nobody for a card nobody is assigned to', () => {
        expect(waitAudience(card({}), board([property('who', 'person')]))).toEqual([])
        expect(waitAudience(card({who: 'user-1'}), board([]))).toEqual([])
        expect(waitAudience(undefined, board([property('who', 'person')]))).toEqual([])
    })

    // While one person works the board every wait is theirs, including the ones
    // on cards assigned to somebody by name.
    it('gives every wait to the person on a one-person install', () => {
        expect(waitIsMine({teamMode: false, myId: 'me', audience: ['somebody-else'], following: false})).toBe(true)
    })

    it('gives a wait to the person the card is assigned to', () => {
        expect(waitIsMine({teamMode: true, myId: 'me', audience: ['me'], following: false})).toBe(true)
        expect(waitIsMine({teamMode: true, myId: 'me', audience: ['somebody-else'], following: false})).toBe(false)
    })

    // Nobody in particular is a stronger claim than nobody at all: an agent
    // stage is the ordinary case and its wait belongs to whoever can answer it.
    it('gives a wait on an unassigned card to everybody', () => {
        expect(waitIsMine({teamMode: true, myId: 'me', audience: [], following: false})).toBe(true)
    })

    it('gives a wait to somebody following the card, whoever it is assigned to', () => {
        expect(waitIsMine({teamMode: true, myId: 'me', audience: ['somebody-else'], following: true})).toBe(true)
    })
})
