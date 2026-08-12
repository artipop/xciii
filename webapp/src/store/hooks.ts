import {Accessor, createMemo, useContext} from 'solid-js'

import {AppStore, AppStoreContext, RootState} from './index'

export function useAppStore(): AppStore {
    const store = useContext(AppStoreContext)
    if (!store) {
        throw new Error('useAppStore must be used inside AppStoreProvider')
    }
    return store
}

export function useAppActions(): AppStore['actions'] {
    return useAppStore().actions
}

// The selector surface the components already speak: a pure function of
// RootState, memoized. The memo subscribes only to the store fields the
// selector actually touches, which is what createSelector's caching bought
// under Redux.
export function useAppSelector<T>(selector: (state: RootState) => T): Accessor<T> {
    const store = useAppStore()
    return createMemo(() => selector(store.state))
}
