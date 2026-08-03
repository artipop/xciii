// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {batch} from 'solid-js'

import {Utils} from '../utils'

import type {StoreContext} from './context'
import type {RootState} from './index'

export interface Team {
    id: string
    title: string
    signupToken: string
    modifiedBy: string
    updateAt: number
}

export type TeamsState = {
    currentId: string
    current: Team | null
    allTeams: Team[]
}

export const initialTeamsState = (): TeamsState => ({
    current: null,
    currentId: '',
    allTeams: [],
})

const byTitle = (a: Team, b: Team) => (a.title < b.title ? -1 : 1)

export const createTeamsActions = ({state, setState, deps}: StoreContext) => ({
    setTeam(teamID: string) {
        setState('teams', 'currentId', teamID)
        const team = state.teams.allTeams.find((t) => t.id === teamID)
        if (!team) {
            Utils.log(`Unable to find team in store. TeamID: ${teamID}`)
            return
        }
        if (state.teams.current === team) {
            return
        }
        setState('teams', 'current', team)
    },
    async fetchTeams(): Promise<void> {
        const teams = await deps.client.getTeams()
        setState('teams', 'allTeams', [...teams].sort(byTitle))
    },
    async regenerateSignupToken(): Promise<void> {
        await deps.client.regenerateTeamSignupToken()
    },
    async refreshCurrentTeam(): Promise<void> {
        const team = await deps.client.getTeam()
        setState('teams', 'current', team)
    },
    // The initialLoad slice of this domain: the current team and the sorted
    // team list arrive together.
    applyInitialLoad(team: Team, teams: Team[]) {
        batch(() => {
            setState('teams', 'current', team)
            setState('teams', 'allTeams', [...teams].sort(byTitle))
        })
    },
})

export const getCurrentTeamId = (state: RootState): string => state.teams.currentId
export const getCurrentTeam = (state: RootState): Team|null => state.teams.current
export const getFirstTeam = (state: RootState): Team|null => state.teams.allTeams[0]
export const getAllTeams = (state: RootState): Team[] => state.teams.allTeams
