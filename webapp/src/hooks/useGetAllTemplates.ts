import {createMemo, onMount} from 'solid-js'
import type {Accessor} from 'solid-js'

import {Board} from '../blocks/board'

import octoClient from '../octoClient'

import {useAppSelector, useAppStore} from '../store/hooks'
import {getGlobalTemplates} from '../store/globalTemplates'
import {getTemplates} from '../store/boards'

import {Constants} from '../constants'

export const useGetAllTemplates = (): Accessor<Board[]> => {
    const {actions} = useAppStore()
    const globalTemplates = useAppSelector<Board[]>(getGlobalTemplates)

    onMount(() => {
        if (octoClient.teamId !== Constants.globalTeamId && globalTemplates().length === 0) {
            actions.globalTemplates.fetchGlobalTemplates()
        }
    })

    const unsortedTemplates = useAppSelector(getTemplates)
    const templates = createMemo(() => Object.values(unsortedTemplates()).sort((a: Board, b: Board) => a.createAt - b.createAt))

    return createMemo(() => (globalTemplates() || []).concat(templates()))
}
