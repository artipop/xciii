// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {BoardsCloudLimits} from '../boardsCloudLimits'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type LimitsState = {
    limits: BoardsCloudLimits
}

export const defaultLimits: BoardsCloudLimits = {
    cards: 0,
    used_cards: 0,
    card_limit_timestamp: 0,
    views: 0,
}

export const initialLimitsState = (): LimitsState => ({limits: {...defaultLimits}})

export const createLimitsActions = ({setState}: StoreContext) => ({
    setLimits(limits: BoardsCloudLimits) {
        setState('limits', 'limits', limits)
    },
    setCardLimitTimestamp(timestamp: number) {
        setState('limits', 'limits', 'card_limit_timestamp', timestamp)
    },
})

export const getLimits = (state: RootState): BoardsCloudLimits | undefined => state.limits.limits
export const getCardLimitTimestamp = (state: RootState): number => state.limits.limits.card_limit_timestamp
