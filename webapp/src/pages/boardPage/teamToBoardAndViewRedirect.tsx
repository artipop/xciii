// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect} from 'solid-js'
import {useNavigate} from '@solidjs/router'

import {getBoards, getCurrentBoardId} from '../../store/boards'
import {getCurrentBoardViews} from '../../store/views'
import type {BoardView} from '../../blocks/boardView'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {useRouteMatch} from '../../hooks/routerMatch'
import {UserSettings} from '../../userSettings'
import {Utils} from '../../utils'
import {getSidebarCategories} from '../../store/sidebar'
import {Constants} from '../../constants'

// oldestView is the view a board was made with: the ties are broken by id so
// two views written in the same millisecond still resolve to the same one every
// time, rather than to whichever the store happened to list first.
export function oldestView(views: BoardView[]): BoardView {
    return views.reduce((oldest, view) => {
        if (view.createAt !== oldest.createAt) {
            return view.createAt < oldest.createAt ? view : oldest
        }
        return view.id < oldest.id ? view : oldest
    })
}

const TeamToBoardAndViewRedirect = (): null => {
    const boardId = useAppSelector(getCurrentBoardId)
    const boardViews = useAppSelector(getCurrentBoardViews)
    const {actions} = useAppStore()
    const navigate = useNavigate()
    const match = useRouteMatch()
    const categories = useAppSelector(getSidebarCategories)
    const boards = useAppSelector(getBoards)
    const teamId = () => match().params.teamId || UserSettings.lastTeamId || Constants.globalTeamId

    createEffect(() => {
        const currentMatch = match()
        let boardID = currentMatch.params.boardId
        if (!currentMatch.params.boardId) {
            // first preference is for last visited board
            boardID = UserSettings.lastBoardId[teamId()]

            // if last visited board is unavailable, use the first board in categories list
            if (!boardID && categories().length > 0) {
                let goToBoardID: string | null = null

                for (const category of categories()) {
                    for (const boardMetadata of category.boardMetadata) {
                        // pick the first category board that exists and is not hidden
                        if (!boardMetadata.hidden && boards()[boardMetadata.boardID]) {
                            goToBoardID = boardMetadata.boardID
                            break
                        }
                    }
                }

                // there may even be no boards at all
                if (goToBoardID) {
                    boardID = goToBoardID
                }
            }

            if (boardID) {
                const newPath = Utils.generatePath(Utils.getBoardPagePath(currentMatch.path), {...currentMatch.params, boardId: boardID, viewID: undefined})
                navigate(newPath, {replace: true})

                // return from here because the loadBoardData() call
                // will fetch the data to be used below. We'll
                // use it in the next render cycle.
                return
            }
        }

        let viewID = currentMatch.params.viewId

        // when a view isn't open,
        // but the data is available, try opening a view
        if ((!viewID || viewID === '0') && boardId() && boardId() === currentMatch.params.boardId && boardViews() && boardViews().length > 0) {
            // most recent view gets the first preference
            viewID = UserSettings.lastViewId[boardID]
            if (viewID) {
                UserSettings.setLastViewId(boardID, viewID)
                actions.views.setCurrent(viewID)
            } else if (boardViews().length > 0) {
                // If there is no most recent view, open the board's oldest one
                // — the view it was made with. The list is sorted by title for
                // the sidebar, and picking its first entry meant which view a
                // board opened on depended on the alphabet: a view added later
                // and named «Входящие» took the board over from «Дела».
                viewID = oldestView(boardViews()).id
                UserSettings.setLastViewId(boardID, viewID)
                actions.views.setCurrent(viewID)
            }

            if (viewID) {
                const newPath = Utils.generatePath(Utils.getBoardPagePath(currentMatch.path), {...currentMatch.params, viewId: viewID})
                navigate(newPath, {replace: true})
            }
        }
    })

    return null
}

export default TeamToBoardAndViewRedirect
