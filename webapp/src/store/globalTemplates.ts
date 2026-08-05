// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Board} from '../blocks/board'
import {Constants} from '../constants'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type GlobalTemplatesState = {value: Board[]}

export const initialGlobalTemplatesState = (): GlobalTemplatesState => ({value: []})

export const createGlobalTemplatesActions = ({setState, deps}: StoreContext) => ({
    async fetchGlobalTemplates(): Promise<void> {
        const templates = await deps.client.getTeamTemplates(Constants.globalTeamId)
        setState('globalTemplates', 'value', templates.sort((a, b) => a.title.localeCompare(b.title)) || [])
    },
})

export function getGlobalTemplates(state: RootState): Board[] {
    return state.globalTemplates.value
}
