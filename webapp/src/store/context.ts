// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {SetStoreFunction} from 'solid-js/store'

import {OctoClient} from '../octoClient'

import type {RootState} from './index'

// What the store needs from the outside world. Injected rather than imported
// so Mutator, WSClient and tests hand in their own client — the store itself
// never reaches for a singleton.
export type StoreDeps = {
    client: OctoClient
}

// StoreContext is what every domain's action factory closes over: the live
// state (for reads inside actions), the setter, and the injected dependencies.
export type StoreContext = {
    state: RootState
    setState: SetStoreFunction<RootState>
    deps: StoreDeps
}
