// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Collapsing a category is a change the server broadcasts back, so the sidebar
// sees the echo of every one of its own clicks. What that echo does to the store
// is what these pin: it must not lose the category's own answers, and it must
// not replace the category, because the sidebar draws one row per category and
// `For` throws a row away the moment its item is a different object.

import {OctoClient} from '../octoClient'

import type {Category, CategoryBoards} from './sidebar'

import {createAppStore} from './index'

const category = (extra: Partial<CategoryBoards> = {}): CategoryBoards => ({
    id: 'category-1',
    name: 'Category',
    userID: 'user-1',
    teamID: 'team-1',
    createAt: 1,
    updateAt: 1,
    deleteAt: 0,
    collapsed: false,
    sortOrder: 0,
    type: 'custom',
    isNew: false,
    boardMetadata: [{boardID: 'board-1', hidden: false}],
    ...extra,
})

const fakeClient = () => ({} as unknown as OctoClient)

describe('the sidebar store', () => {
    test('a category collapsed elsewhere is collapsed here', () => {
        const {state, actions} = createAppStore({client: fakeClient()}, {sidebar: {categoryAttributes: [category()]}})

        actions.sidebar.updateCategories([{...category(), collapsed: true, updateAt: 2} as Category])

        expect(state.sidebar.categoryAttributes[0].collapsed).toBe(true)
    })

    test('an updated category is still the same category', () => {
        const {state, actions} = createAppStore({client: fakeClient()}, {sidebar: {categoryAttributes: [category()]}})
        const before = state.sidebar.categoryAttributes[0]

        actions.sidebar.updateCategories([{...category(), name: 'Renamed', updateAt: 2} as Category])

        expect(state.sidebar.categoryAttributes[0]).toBe(before)
        expect(before.name).toBe('Renamed')
    })

    test('an update leaves the boards filed under the category alone', () => {
        const {state, actions} = createAppStore({client: fakeClient()}, {sidebar: {categoryAttributes: [category()]}})

        actions.sidebar.updateCategories([{...category(), name: 'Renamed'} as Category])

        expect(state.sidebar.categoryAttributes[0].boardMetadata).toEqual([{boardID: 'board-1', hidden: false}])
    })
})
