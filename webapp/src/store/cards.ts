import {batch} from 'solid-js'
import {produce} from 'solid-js/store'

import {Card} from '../blocks/card'
import {IUser} from '../user'
import {Board} from '../blocks/board'
import {Block} from '../blocks/block'
import {BoardView} from '../blocks/boardView'
import {CommentBlock} from '../blocks/commentBlock'
import {Utils} from '../utils'
import {Constants} from '../constants'
import {CardFilter} from '../cardFilter'

import {getCurrentBoard} from './boards'
import {getBoardUsers} from './users'
import {getLastCommentByCard} from './comments'
import {getCurrentView} from './views'
import {getSearchText} from './searchText'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type CardsState = {
    current: string
    cards: {[key: string]: Card}
    templates: {[key: string]: Card}
}

export const initialCardsState = (): CardsState => ({
    current: '',
    cards: {},
    templates: {},
})

// The cards and card templates a fresh board load carries: every full
// (re)load rebuilds both maps from the block list.
export const cardsFromBlocks = (blocks: Block[]): {cards: {[key: string]: Card}, templates: {[key: string]: Card}} => {
    const next: {cards: {[key: string]: Card}, templates: {[key: string]: Card}} = {cards: {}, templates: {}}
    for (const block of blocks) {
        if (block.type === 'card' && block.fields.isTemplate) {
            next.templates[block.id] = block as Card
        } else if (block.type === 'card' && !block.fields.isTemplate) {
            next.cards[block.id] = block as Card
        }
    }
    return next
}

export const createCardsActions = ({setState}: StoreContext) => ({
    setCurrent(cardId: string) {
        setState('cards', 'current', cardId)
    },
    addCard(card: Card) {
        setState('cards', 'cards', card.id, card)
    },
    addTemplate(template: Card) {
        setState('cards', 'templates', template.id, template)
    },
    updateCards(cards: Card[]) {
        setState('cards', produce((s) => {
            for (const card of cards) {
                if (card.deleteAt !== 0) {
                    delete s.cards[card.id]
                    delete s.templates[card.id]
                } else if (card.fields.isTemplate) {
                    s.templates[card.id] = card
                } else {
                    s.cards[card.id] = card
                }
            }
        }))
    },
    setCardsAndTemplates(cards: {[key: string]: Card}, templates: {[key: string]: Card}) {
        batch(() => {
            setState('cards', 'cards', cards)
            setState('cards', 'templates', templates)
        })
    },
})

export const getCards = (state: RootState): {[key: string]: Card} => state.cards.cards

export const getSortedCards = (state: RootState): Card[] =>
    Object.values(getCards(state)).sort((a, b) => a.title.localeCompare(b.title)) as Card[]

export const getTemplates = (state: RootState): {[key: string]: Card} => state.cards.templates

export const getSortedTemplates = (state: RootState): Card[] =>
    Object.values(getTemplates(state)).sort((a, b) => a.title.localeCompare(b.title)) as Card[]

export function getCard(cardId: string): (state: RootState) => Card|undefined {
    return (state: RootState): Card|undefined => {
        return getCards(state)[cardId] || getTemplates(state)[cardId]
    }
}

export const getCurrentBoardCards = (state: RootState): Card[] => {
    const boardId = state.boards.current
    return Object.values(getCards(state)).filter((c) => c.boardId === boardId) as Card[]
}

export const getCurrentBoardTemplates = (state: RootState): Card[] => {
    const boardId = state.boards.current
    return Object.values(getTemplates(state)).filter((c) => c.boardId === boardId) as Card[]
}

function titleOrCreatedOrder(cardA: Card, cardB: Card) {
    const aValue = cardA.title
    const bValue = cardB.title

    if (aValue && bValue) {
        return aValue.localeCompare(bValue)
    }

    // Always put untitled cards at the bottom
    if (aValue && !bValue) {
        return -1
    }
    if (bValue && !aValue) {
        return 1
    }

    // If both cards are untitled, use the create date
    return cardA.createAt - cardB.createAt
}

function manualOrder(activeView: BoardView, cardA: Card, cardB: Card) {
    const indexA = activeView.fields.cardOrder.indexOf(cardA.id)
    const indexB = activeView.fields.cardOrder.indexOf(cardB.id)

    if (indexA < 0 && indexB < 0) {
        return titleOrCreatedOrder(cardA, cardB)
    } else if (indexA < 0 && indexB >= 0) {
        // If cardA's order is not defined, put it at the end
        return 1
    }
    return indexA - indexB
}

function sortCards(cards: Card[], lastCommentByCard: {[key: string]: CommentBlock}, board: Board, activeView: BoardView, usersById: {[key: string]: IUser}): Card[] {
    if (!activeView) {
        return cards
    }
    const {sortOptions} = activeView.fields

    if (sortOptions.length < 1) {
        Utils.log('Manual sort')
        return cards.sort((a, b) => manualOrder(activeView, a, b))
    }

    let sortedCards = cards
    for (const sortOption of sortOptions) {
        if (sortOption.propertyId === Constants.titleColumnId) {
            Utils.log('Sort by title')
            sortedCards = sortedCards.sort((a, b) => {
                const result = titleOrCreatedOrder(a, b)
                return sortOption.reversed ? -result : result
            })
        } else {
            const sortPropertyId = sortOption.propertyId
            const template = board.cardProperties.find((o) => o.id === sortPropertyId)
            if (!template) {
                Utils.logError(`Missing template for property id: ${sortPropertyId}`)
                return sortedCards
            }
            Utils.log(`Sort by property: ${template?.name}`)
            sortedCards = sortedCards.sort((a, b) => {
                // Always put cards with no titles at the bottom, regardless of sort
                let aValue = a.fields.properties[sortPropertyId] || ''
                let bValue = b.fields.properties[sortPropertyId] || ''

                if (template.type === 'createdBy') {
                    aValue = usersById[a.createdBy]?.username || ''
                    bValue = usersById[b.createdBy]?.username || ''
                } else if (template.type === 'updatedBy') {
                    aValue = usersById[a.modifiedBy]?.username || ''
                    bValue = usersById[b.modifiedBy]?.username || ''
                } else if (template.type === 'date') {
                    aValue = (aValue === '') ? '' : JSON.parse(aValue as string).from
                    bValue = (bValue === '') ? '' : JSON.parse(bValue as string).from
                }

                let result = 0
                if (template.type === 'number' || template.type === 'date') {
                    // Always put empty values at the bottom
                    if (aValue && !bValue) {
                        return -1
                    }
                    if (bValue && !aValue) {
                        return 1
                    }
                    if (!aValue && !bValue) {
                        return titleOrCreatedOrder(a, b)
                    }

                    result = Number(aValue) - Number(bValue)
                } else if (template.type === 'createdTime') {
                    result = a.createAt - b.createAt
                } else if (template.type === 'updatedTime') {
                    const aUpdateAt = Math.max(a.updateAt, lastCommentByCard[a.id]?.updateAt || 0)
                    const bUpdateAt = Math.max(b.updateAt, lastCommentByCard[b.id]?.updateAt || 0)
                    result = aUpdateAt - bUpdateAt
                } else {
                    // Text-based sort

                    if (aValue.length > 0 && bValue.length <= 0) {
                        return -1
                    }
                    if (bValue.length > 0 && aValue.length <= 0) {
                        return 1
                    }
                    if (aValue.length <= 0 && bValue.length <= 0) {
                        return titleOrCreatedOrder(a, b)
                    }

                    if (template.type === 'select' || template.type === 'multiSelect') {
                        aValue = template.options.find((o) => o.id === (Array.isArray(aValue) ? aValue[0] : aValue))?.value || ''
                        bValue = template.options.find((o) => o.id === (Array.isArray(bValue) ? bValue[0] : bValue))?.value || ''
                    }

                    if (template.type === 'multiPerson') {
                        aValue = Array.isArray(aValue) && aValue.length !== 0 && Object.keys(usersById).length > 0 ? aValue.map((id) => {
                            if (usersById[id] !== undefined) {
                                return usersById[id].username
                            }
                            return ''
                        }).toString() : aValue

                        bValue = Array.isArray(bValue) && bValue.length !== 0 && Object.keys(usersById).length > 0 ? bValue.map((id) => {
                            if (usersById[id] !== undefined) {
                                return usersById[id].username
                            }
                            return ''
                        }).toString() : bValue
                    }

                    result = (aValue as string).localeCompare(bValue as string)
                }

                if (result === 0) {
                    // In case of "ties", use the title order
                    result = titleOrCreatedOrder(a, b)
                }

                return sortOption.reversed ? -result : result
            })
        }
    }

    return sortedCards
}

function searchFilterCards(cards: Card[], board: Board, searchTextRaw: string): Card[] {
    const searchText = searchTextRaw.toLocaleLowerCase()
    if (!searchText) {
        return cards.slice()
    }

    return cards.filter((card: Card) => {
        const searchTextInCardTitle: boolean = card.title?.toLocaleLowerCase().includes(searchText)
        if (searchTextInCardTitle) {
            return true
        }

        for (const [propertyId, propertyValue] of Object.entries(card.fields.properties)) {
            // TODO: Refactor to a shared function that returns the display value of a property
            const propertyTemplate = board.cardProperties.find((o) => o.id === propertyId)
            if (propertyTemplate && propertyValue) {
                if (propertyTemplate.type === 'select') {
                    // Look up the value of the select option
                    const option = propertyTemplate.options.find((o) => o.id === propertyValue)
                    if (option?.value.toLowerCase().includes(searchText)) {
                        return true
                    }
                } else if (propertyTemplate.type === 'multiSelect') {
                    // Look up the value of the select option
                    const options = (Array.isArray(propertyValue) ? propertyValue : [propertyValue]).map((value) => propertyTemplate.options.find((o) => o.id === value)?.value.toLowerCase())
                    if (options?.includes(searchText)) {
                        return true
                    }
                } else if (propertyTemplate.type !== 'date' && (propertyValue.toString()).toLowerCase().includes(searchText)) {
                    return true
                }
            }
        }

        return false
    })
}

export const getCurrentViewCardsSortedFilteredAndGrouped = (state: RootState): Card[] => {
    const cards = getCurrentBoardCards(state)
    const lastCommentByCard = getLastCommentByCard(state)
    const board = getCurrentBoard(state)
    const view = getCurrentView(state)
    const searchText = getSearchText(state)
    const users = getBoardUsers(state)

    if (!view || !board || !users || !cards) {
        return []
    }
    let result = cards
    if (view.fields.filter) {
        result = CardFilter.applyFilterGroup(view.fields.filter, board.cardProperties, result)
    }

    if (searchText) {
        result = searchFilterCards(result, board, searchText)
    }
    result = sortCards(result, lastCommentByCard, board, view, users)
    return result
}

export const getCurrentCard = (state: RootState): Card|undefined => getCards(state)[state.cards.current]

