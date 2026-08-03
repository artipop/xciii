// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, onCleanup} from 'solid-js'

import wsClient, {WSClient} from '../wsclient'

// teamId is an accessor now; the deps list is gone — the effect re-runs when
// whatever fn reads changes, which is what the list approximated.
export const useWebsockets = (teamId: () => string, fn: (wsClient: WSClient) => () => void): void => {
    createEffect(() => {
        const team = teamId()
        if (!team) {
            return
        }

        wsClient.subscribeToTeam(team)
        const teardown = fn(wsClient)

        onCleanup(() => {
            teardown()
            wsClient.unsubscribeToTeam(team)
        })
    })
}
