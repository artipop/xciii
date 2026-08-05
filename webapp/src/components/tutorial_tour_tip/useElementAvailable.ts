// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createSignal, onCleanup, onMount} from 'solid-js'
import type {Accessor} from 'solid-js'

export default function useElementAvailable(
    elementIds: string[],
): Accessor<boolean> {
    let checkAvailableInterval: ReturnType<typeof setInterval> | null = null
    const [available, setAvailable] = createSignal(false)

    onMount(() => {
        checkAvailableInterval = setInterval(() => {
            if (elementIds.every((x) => document.querySelector(x))) {
                setAvailable(true)
                if (checkAvailableInterval) {
                    clearInterval(checkAvailableInterval)
                    checkAvailableInterval = null
                }
            }
        }, 500)
        onCleanup(() => {
            if (checkAvailableInterval) {
                clearInterval(checkAvailableInterval)
                checkAvailableInterval = null
            }
        })
    })

    return available
}
