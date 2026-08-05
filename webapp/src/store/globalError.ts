// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {StoreContext} from './context'

import type {RootState} from './index'

export type GlobalErrorState = {value: string}

export const initialGlobalErrorState = (): GlobalErrorState => ({value: ''})

export const createGlobalErrorActions = ({setState}: StoreContext) => ({
    setGlobalError(message: string) {
        setState('globalError', 'value', message)
    },
})

export const getGlobalError = (state: RootState): string => state.globalError.value
