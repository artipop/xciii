import {ParentComponent, createEffect, onMount} from 'solid-js'

import wsClient, {MMWebSocketClient} from '../wsclient'

type Props = {
    userId?: string
    manifest?: {
        id: string
        version: string
    }
    webSocketClient?: MMWebSocketClient
}

// WithWebSockets component initialises the websocket connection if
// it's not yet running and subscribes to the current team
const WithWebSockets: ParentComponent<Props> = (props) => {
    const queryString = new URLSearchParams(window.location.search)

    onMount(() => {
        // if the websocket client was already connected, do nothing
        if (wsClient.state !== 'init') {
            return
        }

        const token = localStorage.getItem('xciiiSessionId') || queryString.get('r') || ''
        if (token) {
            wsClient.authenticate(token)
        }
        wsClient.open()
    })

    createEffect(() => {
        if (!props.userId) {
            return
        }

        const token = localStorage.getItem('xciiiSessionId') || queryString.get('r') || ''
        if (wsClient.token !== token) {
            wsClient.authenticate(token)
        }
    })

    return <>{props.children}</>
}

export default WithWebSockets
