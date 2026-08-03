// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

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

// The successor of redux-mock-store's mockStateStore: a real app store seeded
// with the test's state, so selectors read it and actions write over it.
export function mockAppStore(state?: {[K in keyof RootState]?: Partial<RootState[K]>}, deps?: StoreDeps): AppStore {
    return createAppStore(deps ?? {client: {} as StoreDeps['client']}, state)
}

export const wrapStore = (store: AppStore, children?: () => JSX.Element): JSX.Element => (
    <AppStoreProvider store={store}>
        {children?.()}
    </AppStoreProvider>
)

export function mockDOM(): void {
    window.focus = jest.fn()
    document.createRange = () => {
        const range = new Range()
        range.getBoundingClientRect = jest.fn()
        range.getClientRects = () => {
            return {
                item: () => null,
                length: 0,
                [Symbol.iterator]: jest.fn(),
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
        value: jest.fn().mockImplementation(() => {
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
