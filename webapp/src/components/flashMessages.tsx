import {Show, createSignal, onCleanup, onMount} from 'solid-js'
import type {Component, JSX} from 'solid-js'
import {createNanoEvents} from 'nanoevents'

import {useIntl} from '../intl'

import './flashMessages.scss'

export type FlashMessage = {
    content: JSX.Element
    severity: 'low' | 'normal' | 'high'

    // A notice is a sentence, not a confirmation: it takes the corner-card
    // shape of the agent notifications rather than the centered pill, gets a
    // close button of its own, and usually asks for more time than the
    // mount-wide default.
    notice?: boolean
    milliseconds?: number
}

const emitter = createNanoEvents()

export function sendFlashMessage(message: FlashMessage): void {
    emitter.emit('message', message)
}

type Props = {
    milliseconds: number
}

export const FlashMessages: Component<Props> = (props) => {
    const intl = useIntl()
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
                timeoutId = setTimeout(handleFadeOut, (newMessage.milliseconds ?? props.milliseconds) - 200)
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
                class={'FlashMessages ' + message()!.severity + (message()!.notice ? ' FlashMessages--notice' : '') + (fadeOut() ? ' flashOut' : ' flashIn')}
                onClick={handleClick}
            >
                {message()!.content}
                <Show when={message()!.notice}>
                    <button
                        type='button'
                        class='FlashMessages__close'
                        title={intl.formatMessage({id: 'Modal.close', defaultMessage: 'Close'})}
                        aria-label={intl.formatMessage({id: 'Modal.close', defaultMessage: 'Close'})}
                        onClick={handleClick}
                    >
                        {'×'}
                    </button>
                </Show>
            </div>
        </Show>
    )
}
