// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onCleanup, onMount} from 'solid-js'
import type {Component} from 'solid-js'
import {Picker} from 'emoji-mart'

import './emojiPicker.scss'

type Props = {
    onSelect: (emoji: string) => void
}

type PickedEmoji = {
    native?: string
}

// emoji-mart 5 is not a framework component: Picker is a custom element that
// mounts itself into a host node, so the wrapper stays this small. The data
// set is registered once at startup in main.tsx.
const EmojiPicker: Component<Props> = (props) => {
    let host: HTMLDivElement | undefined

    onMount(() => {
        const node = host
        if (!node) {
            return
        }

        // v5 draws native glyphs instead of the sprite sheet v3 needed, so the
        // 3.7 MB emoji_spirit.png is no longer shipped. It also renders into a
        // shadow root, which is why the .emoji-mart-* overrides that used to sit
        // in emojiPicker.scss cannot reach it any more.
        const picker = new Picker({
            parent: node,
            previewPosition: 'none',
            onEmojiSelect: (emoji: PickedEmoji) => {
                if (emoji.native) {
                    // props.onSelect is read at pick time, so a new handler
                    // never remounts the picker and never loses its state.
                    props.onSelect(emoji.native)
                }
            },
        }) as unknown as {remove?: () => void}

        onCleanup(() => {
            picker.remove?.()
            node.replaceChildren()
        })
    })

    return (
        <div
            class='EmojiPicker'
            onClick={(e) => e.stopPropagation()}
        >
            <div ref={host}/>
        </div>
    )
}

export default EmojiPicker
