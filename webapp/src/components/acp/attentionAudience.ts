import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'

// Who an agent's wait is announced to.
//
// While one person works the board the question does not arise: every wait is
// theirs, and it is drawn to whoever is looking. In a team the same box says
// "an agent is waiting" to somebody who has nothing to do with that card, and
// what makes a notification worth keeping switched on is that it is about you
// (docs/teamwork.md).
//
// The card already answers it. «Кто занимается» is the field the whole board
// uses to say who a card belongs to — a person or an agent, in one field
// (internal/acp/agents.go, humanAssignee) — so a wait on a card assigned to a
// person is that person's. A card assigned to an agent, or to nobody, names no
// person and is therefore everybody's: an agent stage is the ordinary case, and
// a wait nobody would be told about is a wait nobody answers.
//
// Following the card is the other way in, for somebody who is not the
// assignee and wants to be told anyway. The list is real again
// (octoClient.getUserBlockSubscriptions); what is missing is a control that
// puts a card on it, which docs/deferred.md records.

// personProperty is the field a board says who a card belongs to in. Found by
// its *type* and never by its name, the same rule the Go side follows: this
// application names it «Кто занимается» when it makes one, and a person may
// call it anything. The first by the board's own order, so a board with two
// person fields answers with the one its views show first.
export function personProperty(board?: Board): IPropertyTemplate | undefined {
    if (!board?.cardProperties) {
        return undefined
    }
    return board.cardProperties.find((p) => p.type === 'person' || p.type === 'multiPerson')
}

// waitAudience is the user ids a card names, and an empty list means everybody:
// nobody in particular is a stronger claim than nobody at all.
export function waitAudience(card?: Card, board?: Board): string[] {
    const property = personProperty(board)
    if (!card || !property) {
        return []
    }
    const value = card.fields?.properties?.[property.id]
    if (!value) {
        return []
    }
    return (Array.isArray(value) ? value : [value]).filter(Boolean)
}

// waitIsMine answers the one question the notification stack asks of a wait.
// teamMode is what makes it a question at all — on an install of one person
// every wait is theirs, including the ones on cards assigned to nobody.
export function waitIsMine(args: {
    teamMode: boolean
    myId?: string
    audience: string[]
    following: boolean
}): boolean {
    if (!args.teamMode || args.audience.length === 0 || args.following) {
        return true
    }
    return Boolean(args.myId) && args.audience.includes(args.myId!)
}
