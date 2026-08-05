// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The store is the contract every ported component will lean on, so this suite
// pins its observable behaviour before any UI exists on top: the RootState
// shape, the load fan-out into multiple domains, and the reactive edge — an
// effect must re-run when an action changes what a selector reads.

import {createRenderEffect, createRoot} from 'solid-js'

import {ErrorId} from '../errors'
import {Card} from '../blocks/card'
import {Board} from '../blocks/board'
import {OctoClient} from '../octoClient'

import {getCurrentBoard, getMySortedBoards} from './boards'
import {getCards, getCurrentCard} from './cards'
import {getCurrentTeam} from './teams'
import {getGlobalError} from './globalError'
import {getMyConfig} from './users'

import {createAppStore} from './index'

const board = (id: string, title: string, extra: Partial<Board> = {}): Board => ({
    id,
    title,
    teamId: 'team-1',
    isTemplate: false,
    deleteAt: 0,
    cardProperties: [],
    ...extra,
} as Board)

const card = (id: string, boardId: string, title: string, extra: Partial<Card> = {}): Card => ({
    id,
    boardId,
    title,
    type: 'card',
    parentId: boardId,
    deleteAt: 0,
    createAt: 1,
    updateAt: 1,
    fields: {properties: {}, contentOrder: [], isTemplate: false},
    ...extra,
} as Card)

const fakeClient = (overrides: Partial<OctoClient> = {}): OctoClient => ({
    getMe: jest.fn(async () => ({id: 'user-1', username: 'user'})),
    getMyConfig: jest.fn(async () => []),
    getTeam: jest.fn(async () => ({id: 'team-1', title: 'Team'})),
    getTeams: jest.fn(async () => [{id: 'team-1', title: 'Team'}]),
    getBoards: jest.fn(async () => [board('board-1', 'Alpha')]),
    getMyBoardMemberships: jest.fn(async () => [{boardId: 'board-1', userId: 'user-1', schemeAdmin: true}]),
    getTeamTemplates: jest.fn(async () => []),
    getBoardsCloudLimits: jest.fn(async () => ({cards: 0, used_cards: 0, card_limit_timestamp: 0, views: 0})),
    ...overrides,
} as unknown as OctoClient)

describe('createAppStore', () => {
    test('updateCards routes cards, templates and deletions to their maps', () => {
        const {state, actions} = createAppStore({client: fakeClient()})

        actions.cards.updateCards([
            card('card-1', 'board-1', 'One'),
            card('tpl-1', 'board-1', 'Tpl', {fields: {properties: {}, contentOrder: [], isTemplate: true}}),
        ])
        expect(Object.keys(state.cards.cards)).toEqual(['card-1'])
        expect(Object.keys(state.cards.templates)).toEqual(['tpl-1'])

        actions.cards.updateCards([card('card-1', 'board-1', 'One', {deleteAt: 1})])
        expect(Object.keys(state.cards.cards)).toEqual([])
    })

    test('initialLoad fills teams, boards and memberships in one call', async () => {
        const store = createAppStore({client: fakeClient()})

        await store.actions.load.initialLoad()

        expect(getCurrentTeam(store.state)?.id).toBe('team-1')
        expect(getMySortedBoards(store.state).map((b) => b.id)).toEqual(['board-1'])
        expect(getGlobalError(store.state)).toBe('')
    })

    test('initialLoad without a session sets the global error and rethrows', async () => {
        const store = createAppStore({client: fakeClient({getMe: jest.fn(async () => undefined)} as Partial<OctoClient>)})

        await expect(store.actions.load.initialLoad()).rejects.toThrow(ErrorId.NotLoggedIn)
        expect(getGlobalError(store.state)).toBe(ErrorId.NotLoggedIn)
    })

    test('an effect over a selector re-runs when an action changes its input', () => {
        const store = createAppStore({client: fakeClient()})
        const seen: Array<string|undefined> = []

        // The root body itself runs batched, so the actions live outside it:
        // only then does each one propagate synchronously, the way a store
        // update outside any render pass does in the app.
        const dispose = createRoot((d) => {
            createRenderEffect(() => {
                seen.push(getCurrentCard(store.state)?.title)
            })
            return d
        })

        store.actions.cards.updateCards([card('card-1', 'board-1', 'One')])
        store.actions.cards.setCurrent('card-1')
        store.actions.cards.updateCards([card('card-1', 'board-1', 'Renamed')])

        expect(seen).toEqual([undefined, 'One', 'Renamed'])
        dispose()
    })

    test('current board follows setCurrent across boards and templates', () => {
        const {state, actions} = createAppStore({client: fakeClient()})

        actions.boards.updateBoards([board('board-1', 'Alpha'), board('tpl-1', 'Tpl', {isTemplate: true})])
        actions.boards.setCurrent('board-1')
        expect(getCurrentBoard(state)?.title).toBe('Alpha')
        actions.boards.setCurrent('tpl-1')
        expect(getCurrentBoard(state)?.title).toBe('Tpl')
    })

    test('user preferences parse into myConfig', () => {
        const {state, actions} = createAppStore({client: fakeClient()})

        actions.users.patchProps([{user_id: 'user-1', category: 'focalboard', name: 'onboardingTourStep', value: '3'}])
        expect(getMyConfig(state).onboardingTourStep?.value).toBe('3')
    })

    test('getCards returns the live map, not a copy', () => {
        const {state, actions} = createAppStore({client: fakeClient()})

        const before = getCards(state)
        expect(Object.keys(before)).toHaveLength(0)
        actions.cards.addCard(card('card-1', 'board-1', 'One'))
        expect(getCards(state)['card-1'].title).toBe('One')
    })
})
