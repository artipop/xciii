// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createSignal, onCleanup} from 'solid-js'

import {FormattedMessage} from '../../intl'

import wsClient, {WSClient} from '../../wsclient'
import {useAppSelector} from '../../store/hooks'

import {getMe} from '../../store/users'
import {IUser} from '../../user'

const websocketTimeoutForBanner = 5000

// WebsocketConnection component checks the websockets client for
// state changes and if the connection is closed, shows a banner
// indicating that there has been a connection error
const WebsocketConnection = () => {
    const [websocketClosed, setWebsocketClosed] = createSignal(false)
    const me = useAppSelector<IUser|null>(getMe)

    createEffect(() => {
        void me()?.id
        let timeout: ReturnType<typeof setTimeout>
        const updateWebsocketState = (_: WSClient, newState: 'init'|'open'|'close'): void => {
            if (timeout) {
                clearTimeout(timeout)
            }

            if (newState === 'close') {
                timeout = setTimeout(() => {
                    setWebsocketClosed(true)
                }, websocketTimeoutForBanner)
            } else {
                setWebsocketClosed(false)
            }
        }

        wsClient.addOnStateChange(updateWebsocketState)

        onCleanup(() => {
            if (timeout) {
                clearTimeout(timeout)
            }
            wsClient.removeOnStateChange(updateWebsocketState)
        })
    })

    return (
        <Show when={websocketClosed()}>
            <div class='WSConnection error'>
                {/* The message used to link a troubleshooting page upstream
                    hosted; this app has none, so it stands on its own. */}
                <FormattedMessage
                    id='Error.websocket-closed'
                    defaultMessage='Websocket connection closed, connection interrupted. If this persists, check your server or web proxy configuration.'
                />
            </div>
        </Show>
    )
}

export default WebsocketConnection
