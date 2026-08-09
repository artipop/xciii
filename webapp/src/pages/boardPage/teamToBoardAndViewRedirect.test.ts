// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createBoardView} from '../../blocks/boardView'
import type {BoardView} from '../../blocks/boardView'

import {oldestView} from './teamToBoardAndViewRedirect'

const view = (id: string, title: string, createAt: number): BoardView => ({
    ...createBoardView(),
    id,
    title,
    createAt,
})

describe('pages/boardPage/teamToBoardAndViewRedirect', () => {
    // A board opens on the view it was made with. The list it comes from is
    // sorted by title for the sidebar, so taking its first entry made the
    // alphabet decide: a view added later and named «Входящие» took the board
    // over from «Дела».
    it('opens the board on its oldest view, not its first by title', () => {
        const views = [
            view('v-inbox', 'Входящие', 2000),
            view('v-board', 'Дела', 1000),
        ]

        expect(oldestView(views).id).toBe('v-board')
    })

    // Two views written in the same millisecond still have to resolve to the
    // same one every time, or which view a board opens on depends on the order
    // the store happened to list them in.
    it('breaks a tie the same way every time', () => {
        const views = [view('v-b', 'Б', 1000), view('v-a', 'А', 1000)]

        expect(oldestView(views).id).toBe('v-a')
        expect(oldestView([...views].reverse()).id).toBe('v-a')
    })

    it('a board with one view opens on it', () => {
        expect(oldestView([view('v-only', 'Дела', 1000)]).id).toBe('v-only')
    })
})
