// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal, onCleanup, onMount} from 'solid-js'
import type {Component, JSX} from 'solid-js'
import {createNanoEvents} from 'nanoevents'

import './flashMessages.scss'

export type FlashMessage = {
    content: JSX.Element
    severity: 'low' | 'normal' | 'high'
}

const emitter = createNanoEvents()

export function sendFlashMessage(message: FlashMessage): void {
    emitter.emit('message', message)
}

type Props = {
    milliseconds: number
}

export const FlashMessages: Component<Props> = (props) => {
    const [message, setMessage] = createSignal<FlashMessage|null>(null)
    const [fadeOut, setFadeOut] = createSignal(false)
    let timeoutId: ReturnType<typeof setTimeout>|null = null

    const handleTimeout = (): void => {
        setMessage(null)
        setFadeOut(false)
    }

    const handleFadeOut = (): void => {
        setFadeOut(true)
        timeoutId = setTimeout(handleTimeout, 200)
    }

    const handleClick = (): void => {
        if (timeoutId) {
            clearTimeout(timeoutId)
            timeoutId = null
        }
        handleFadeOut()
    }

    onMount(() => {
        let isSubscribed = true
        emitter.on('message', (newMessage: FlashMessage) => {
            if (isSubscribed) {
                if (timeoutId) {
                    clearTimeout(timeoutId)
                    timeoutId = null
                }
                timeoutId = setTimeout(handleFadeOut, props.milliseconds - 200)
                setMessage(newMessage)
            }
        })
        onCleanup(() => {
            isSubscribed = false
        })
    })

    return (
        <Show when={message()}>
            <div
                class={'FlashMessages ' + message()!.severity + (fadeOut() ? ' flashOut' : ' flashIn')}
                onClick={handleClick}
            >
                {message()!.content}
            </div>
        </Show>
    )
}
