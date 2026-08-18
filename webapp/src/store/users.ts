import {batch} from 'solid-js'
import {produce, reconcile} from 'solid-js/store'

import {IUser, parseUserProps, UserPreference} from '../user'
import {Subscription} from '../wsclient'

import type {StoreContext} from './context'

import type {RootState} from './index'

export const versionProperty = 'version72MessageCanceled'

export type UsersState = {
    me: IUser|null
    boardUsers: {[key: string]: IUser}
    loggedIn: boolean|null
    blockSubscriptions: Subscription[]
    myConfig: Record<string, UserPreference>
}

export const initialUsersState = (): UsersState => ({
    me: null,
    boardUsers: {},
    loggedIn: null,
    blockSubscriptions: [],
    myConfig: {},
})

export const createUsersActions = ({setState, deps}: StoreContext) => ({
    setMe(me: IUser|null) {
        batch(() => {
            setState('users', 'me', me)
            setState('users', 'loggedIn', Boolean(me))
        })
    },
    setBoardUsers(users: IUser[]) {
        setState('users', 'boardUsers', users.reduce((acc: {[key: string]: IUser}, user: IUser) => {
            acc[user.id] = user
            return acc
        }, {}))
    },
    addBoardUsers(users: IUser[]) {
        setState('users', 'boardUsers', produce((boardUsers) => {
            users.forEach((user: IUser) => {
                boardUsers[user.id] = user
            })
        }))
    },
    removeBoardUsersById(userIds: string[]) {
        setState('users', 'boardUsers', produce((boardUsers) => {
            userIds.forEach((userId: string) => {
                delete boardUsers[userId]
            })
        }))
    },
    followBlock(subscription: Subscription) {
        setState('users', 'blockSubscriptions', (subs) => [...subs, subscription])
    },
    unfollowBlock(subscription: Subscription) {
        setState('users', 'blockSubscriptions', (subs) => subs.filter((s) => s.blockId !== subscription.blockId))
    },

    // The response carries every preference the person has left, so it replaces
    // the config rather than being merged into it — and `setState` with a plain
    // object merges. A preference *deleted* server-side therefore survived in
    // the store for ever: settings could forget that the welcome screen had been
    // shown, and the page went on believing it had.
    patchProps(props: UserPreference[]) {
        setState('users', 'myConfig', reconcile(parseUserProps(props)))
    },
    async fetchMe(): Promise<void> {
        try {
            const [me, myConfig] = await Promise.all([
                deps.client.getMe(),
                deps.client.getMyConfig(),
            ])
            batch(() => {
                setState('users', 'me', me || null)
                setState('users', 'loggedIn', Boolean(me))
                if (myConfig) {
                    setState('users', 'myConfig', reconcile(parseUserProps(myConfig)))
                }
            })
        } catch (e) {
            batch(() => {
                setState('users', 'me', null)
                setState('users', 'loggedIn', false)
                setState('users', 'myConfig', {})
            })
        }
    },
    fetchUserBlockSubscriptions() {
        setState('users', 'blockSubscriptions', [])
    },
})

export const getMe = (state: RootState): IUser|null => state.users.me
export const getLoggedIn = (state: RootState): boolean|null => state.users.loggedIn
export const getBoardUsers = (state: RootState): {[key: string]: IUser} => state.users.boardUsers
export const getMyConfig = (state: RootState): Record<string, UserPreference> => state.users.myConfig || {} as Record<string, UserPreference>

export const getBoardUsersList = (state: RootState): IUser[] =>
    Object.values(getBoardUsers(state)).sort((a, b) => a.username.localeCompare(b.username))

export const getUser = (userId: string): (state: RootState) => IUser|undefined => {
    return (state: RootState): IUser|undefined => {
        const users = getBoardUsers(state)
        return users[userId]
    }
}

export const getOnboardingTourStarted = (state: RootState): boolean => {
    const myConfig = getMyConfig(state)
    if (!myConfig) {
        return false
    }
    return Boolean(myConfig.onboardingTourStarted?.value)
}

export const getOnboardingTourStep = (state: RootState): string => {
    const myConfig = getMyConfig(state)
    if (!myConfig) {
        return ''
    }
    return myConfig.onboardingTourStep?.value
}

export const getOnboardingTourCategory = (state: RootState): string => {
    const myConfig = getMyConfig(state)
    return myConfig.tourCategory ? myConfig.tourCategory.value : ''
}

export const getVersionMessageCanceled = (state: RootState): boolean => {
    const me = getMe(state)
    const myConfig = getMyConfig(state)
    if (versionProperty && me) {
        if (me.id === 'single-user') {
            return true
        }
        return Boolean(myConfig[versionProperty]?.value)
    }
    return true
}

