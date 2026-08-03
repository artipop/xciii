// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {StoreContext} from './context'
import type {RootState} from './index'

export const ChannelTypeOpen = 'O'
export const ChannelTypePrivate = 'P'
export const ChannelTypeDirectMessage = 'D'
export const ChannelTypeGroupMessage = 'G'
type ChannelType = typeof ChannelTypeOpen | typeof ChannelTypePrivate |
    typeof ChannelTypeDirectMessage | typeof ChannelTypeGroupMessage

export interface Channel {
    id: string
    name: string
    display_name: string
    type: ChannelType
}

export type ChannelsState = {
    current: Channel | null
}

export const initialChannelsState = (): ChannelsState => ({current: null})

export const createChannelsActions = ({state, setState}: StoreContext) => ({
    setChannel(channel: Channel) {
        if (state.channels.current === channel) {
            return
        }
        setState('channels', 'current', channel)
    },
})

export const getCurrentChannel = (state: RootState): Channel|null => state.channels.current
