// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onCleanup, onMount} from 'solid-js'
import type {Component} from 'solid-js'
import {Picker} from 'emoji-mart'

import {useIntl} from '../intl'

import './emojiPicker.scss'

type Props = {
    onSelect: (emoji: string) => void
}

type PickedEmoji = {
    native?: string
}

// «Часто используемые», «Люди», «Поиск» — every word the picker draws around
// the glyphs is emoji-mart's own, and it carries English alone. Handed a
// locale and no `i18n`, it fetches the rest from jsdelivr, which is a network
// this app does not have and an origin the page may not reach; so the bundle
// is imported here instead, one chunk per language and only when asked for.
// A language emoji-mart has no bundle for gets no `i18n` at all, which is what
// leaves it on the English it ships with.
function emojiI18n(locale: string): Promise<unknown> | undefined {
    switch (locale.toLowerCase().split('-')[0]) {
    case 'de':
        return import('@emoji-mart/data/i18n/de.json').then((m) => m.default)
    case 'es':
        return import('@emoji-mart/data/i18n/es.json').then((m) => m.default)
    case 'fr':
        return import('@emoji-mart/data/i18n/fr.json').then((m) => m.default)
    case 'it':
        return import('@emoji-mart/data/i18n/it.json').then((m) => m.default)
    case 'ja':
        return import('@emoji-mart/data/i18n/ja.json').then((m) => m.default)
    case 'nl':
        return import('@emoji-mart/data/i18n/nl.json').then((m) => m.default)
    case 'pt':
        return import('@emoji-mart/data/i18n/pt.json').then((m) => m.default)
    case 'ru':
        return import('@emoji-mart/data/i18n/ru.json').then((m) => m.default)
    case 'tr':
        return import('@emoji-mart/data/i18n/tr.json').then((m) => m.default)
    case 'zh':
        return import('@emoji-mart/data/i18n/zh.json').then((m) => m.default)
    default:
        return undefined
    }
}

// emoji-mart 5 is not a framework component: Picker is a custom element that
// mounts itself into a host node, so the wrapper stays this small. The data
// set is registered once at startup in main.tsx.
const EmojiPicker: Component<Props> = (props) => {
    const intl = useIntl()
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
        const locale = intl.locale
        const picker = new Picker({
            parent: node,
            previewPosition: 'none',
            i18n: () => emojiI18n(locale),
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
