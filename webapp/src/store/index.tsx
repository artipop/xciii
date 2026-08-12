// The application store: one solid-js/store holding the same RootState shape
// the Redux store had, and a tree of domain actions where reducers and thunks
// used to be. Nothing here is global — createAppStore builds an instance, the
// provider hands it down, and dependencies (the HTTP client) are injected so
// Mutator, WSClient and tests bring their own.

import {createContext, ParentComponent} from 'solid-js'
import {createStore} from 'solid-js/store'

import octoClient from '../octoClient'

import type {StoreContext, StoreDeps} from './context'
import {UsersState, initialUsersState, createUsersActions} from './users'
import {TeamsState, initialTeamsState, createTeamsActions} from './teams'
import {ChannelsState, initialChannelsState, createChannelsActions} from './channels'
import {LanguageState, initialLanguageState, createLanguageActions} from './language'
import {GlobalTemplatesState, initialGlobalTemplatesState, createGlobalTemplatesActions} from './globalTemplates'
import {BoardsState, initialBoardsState, createBoardsActions} from './boards'
import {ViewsState, initialViewsState, createViewsActions} from './views'
import {CardsState, initialCardsState, createCardsActions} from './cards'
import {ContentsState, initialContentsState, createContentsActions} from './contents'
import {CommentsState, initialCommentsState, createCommentsActions} from './comments'
import {SearchTextState, initialSearchTextState, createSearchTextActions} from './searchText'
import {GlobalErrorState, initialGlobalErrorState, createGlobalErrorActions} from './globalError'
import {ClientConfigState, initialClientConfigState, createClientConfigActions} from './clientConfig'
import {SidebarState, initialSidebarState, createSidebarActions} from './sidebar'
import {LimitsState, initialLimitsState, createLimitsActions} from './limits'
import {AttachmentsState, initialAttachmentsState, createAttachmentsActions} from './attachments'
import {createInitialLoadActions} from './initialLoad'

export type RootState = {
    users: UsersState
    teams: TeamsState
    channels: ChannelsState
    language: LanguageState
    globalTemplates: GlobalTemplatesState
    boards: BoardsState
    views: ViewsState
    cards: CardsState
    contents: ContentsState
    comments: CommentsState
    searchText: SearchTextState
    globalError: GlobalErrorState
    clientConfig: ClientConfigState
    sidebar: SidebarState
    limits: LimitsState
    attachments: AttachmentsState
}

export const initialRootState = (): RootState => ({
    users: initialUsersState(),
    teams: initialTeamsState(),
    channels: initialChannelsState(),
    language: initialLanguageState(),
    globalTemplates: initialGlobalTemplatesState(),
    boards: initialBoardsState(),
    views: initialViewsState(),
    cards: initialCardsState(),
    contents: initialContentsState(),
    comments: initialCommentsState(),
    searchText: initialSearchTextState(),
    globalError: initialGlobalErrorState(),
    clientConfig: initialClientConfigState(),
    sidebar: initialSidebarState(),
    limits: initialLimitsState(),
    attachments: initialAttachmentsState(),
})

export type AppStore = {
    state: RootState
    actions: ReturnType<typeof createActions>
}

const createActions = (ctx: StoreContext) => {
    const users = createUsersActions(ctx)
    const boardsBase = createBoardsActions(ctx)

    return {
        users,
        teams: createTeamsActions(ctx),
        channels: createChannelsActions(ctx),
        language: createLanguageActions(ctx),
        globalTemplates: createGlobalTemplatesActions(ctx),

        // The two boards actions that used to dispatch into the users slice
        // get the users actions closed over here, so callers see one argument.
        boards: {
            ...boardsBase,
            fetchBoardMembers: (args: {teamId: string, boardId: string}) =>
                boardsBase.fetchBoardMembers(args, users.setBoardUsers),
            updateMembersEnsuringBoardsAndUsers: (members: Parameters<typeof boardsBase.updateMembersEnsuringBoardsAndUsers>[0]) =>
                boardsBase.updateMembersEnsuringBoardsAndUsers(members, users),
        },
        views: createViewsActions(ctx),
        cards: createCardsActions(ctx),
        contents: createContentsActions(ctx),
        comments: createCommentsActions(ctx),
        searchText: createSearchTextActions(ctx),
        globalError: createGlobalErrorActions(ctx),
        clientConfig: createClientConfigActions(ctx),
        sidebar: createSidebarActions(ctx),
        limits: createLimitsActions(ctx),
        attachments: createAttachmentsActions(ctx),
        load: createInitialLoadActions(ctx),
    }
}

// initialState is for tests: a partial RootState merged over the defaults, the
// role redux-mock-store's preloaded state used to play — except this store is
// real, so actions keep working on top of the seeded data.
export function createAppStore(deps: StoreDeps = {client: octoClient}, initialState?: {[K in keyof RootState]?: Partial<RootState[K]>}): AppStore {
    const base = initialRootState()
    if (initialState) {
        for (const key of Object.keys(initialState) as Array<keyof RootState>) {
            Object.assign(base[key], initialState[key])
        }
    }
    const [state, setState] = createStore<RootState>(base)
    const ctx: StoreContext = {state, setState, deps}
    return {state, actions: createActions(ctx)}
}

export const AppStoreContext = createContext<AppStore>()

export const AppStoreProvider: ParentComponent<{store?: AppStore}> = (props) => {
    const store = props.store ?? createAppStore()
    return (
        <AppStoreContext.Provider value={store}>
            {props.children}
        </AppStoreContext.Provider>
    )
}
