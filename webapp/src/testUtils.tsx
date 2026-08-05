// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX, ParentComponent} from 'solid-js'
import {MemoryRouter, Route, createMemoryHistory} from '@solidjs/router'

import {IntlProvider} from './intl'
import {SortableProvider} from './hooks/sortable'
import {Block} from './blocks/block'
import {AppStore, AppStoreProvider, RootState, createAppStore} from './store'
import type {StoreDeps} from './store/context'

// Children arrive as thunks: JSX passed as a plain argument is created before
// the provider exists, and a component created outside the provider tree never
// sees its context. The thunk is invoked inside the provider instead.
export const wrapIntl = (children?: () => JSX.Element): JSX.Element => (
    <IntlProvider
        locale='en'
        messages={{}}
    >
        {children?.()}
    </IntlProvider>
)
export const wrapDNDIntl = (children?: () => JSX.Element): JSX.Element => {
    return (
        <SortableProvider>
            {wrapIntl(children)}
        </SortableProvider>
    )
}

// One provider serves both halves now: the sidebar's sortables and the cards'
// drop targets live in the same dnd-kit context, so these two wrappers, which
// existed only because react-beautiful-dnd needed its own, are the same thing.
export const wrapRBDNDContext = (children?: () => JSX.Element): JSX.Element => {
    return (
        <SortableProvider>
            {children?.()}
        </SortableProvider>
    )
}

export const wrapRBDNDDroppable = (children?: () => JSX.Element): JSX.Element => wrapRBDNDContext(children)

// A memory router around a component that only needs the router to exist —
// links, useNavigate, useRouteMatch. The wildcard route matches whatever path
// the test starts at, and children are read inside it, so router context is
// there by the time they are created. What react-router tests spelled as
// <Router history={history}> around the component.
export const TestRouter: ParentComponent<{path?: string}> = (props) => {
    const history = createMemoryHistory()
    history.set({value: props.path || '/'})
    return (
        <MemoryRouter history={history}>
            <Route
                path='*rest'
                component={() => props.children}
            />
        </MemoryRouter>
    )
}

// The successor of redux-mock-store's mockStateStore: a real app store seeded
// with the test's state, so selectors read it and actions write over it.
// The default client answers every call with a resolved undefined — an action
// fired by a mounting component must not crash a test that never asked for it.
// A test that asserts on client calls passes its own (usually the automocked
// octoClient) through deps.
const nullClient = new Proxy({}, {
    get: () => () => Promise.resolve(undefined),
}) as StoreDeps['client']

export function mockAppStore(state?: {[K in keyof RootState]?: Partial<RootState[K]>}, deps?: StoreDeps): AppStore {
    return createAppStore(deps ?? {client: nullClient}, state)
}

export const wrapStore = (store: AppStore, children?: () => JSX.Element): JSX.Element => (
    <AppStoreProvider store={store}>
        {children?.()}
    </AppStoreProvider>
)

export function mockDOM(): void {
    window.focus = vi.fn()
    document.createRange = () => {
        const range = new Range()
        range.getBoundingClientRect = vi.fn()
        range.getClientRects = () => {
            return {
                item: () => null,
                length: 0,
                [Symbol.iterator]: vi.fn(),
            }
        }
        return range
    }
}
export function mockMatchMedia(result: {matches: boolean}): void {
    // We check if system preference is dark or light theme.
    // This is required to provide it's definition since
    // window.matchMedia doesn't exist in Jest.
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(() => {
            return result
        }),
    })
}

export type BlocksById<BlockType> = {[key: string]: BlockType}

export function blocksById<BlockType extends Block>(blocks: BlockType[]): BlocksById<BlockType> {
    return blocks.reduce((res, block) => {
        res[block.id] = block
        return res
    }, {} as BlocksById<BlockType>)
}
