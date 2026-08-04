// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, createSignal, on, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {SearchIndex} from 'emoji-mart'

import {$createTextNode, $getSelection, $isRangeSelection, LexicalEditor, TextNode} from 'lexical'

import {TypeaheadMenu, basicTypeaheadTriggerMatch} from './typeahead'

type EmojiResult = {
    id: string
    name: string
    colons: string
    native: string
}

const MAX_EMOJI_SUGGESTIONS = 10

// `:`-triggered emoji autocomplete backed by emoji-mart's search index. Inserts
// the picked emoji's native glyph, replacing the `:query` trigger text.
type Props = {
    editor: LexicalEditor
}

const EmojiPlugin = (props: Props): JSX.Element => {
    const [query, setQuery] = createSignal<string | null>(null)
    const [options, setOptions] = createSignal<EmojiResult[]>([])

    const triggerFn = basicTypeaheadTriggerMatch(':', {minLength: 1})

    // emoji-mart 5 searches asynchronously and puts the glyph on the emoji's
    // first skin rather than on the emoji itself.
    createEffect(on(query, (q) => {
        if (!q) {
            setOptions([])
            return
        }

        let cancelled = false
        onCleanup(() => {
            cancelled = true
        })
        SearchIndex.search(q).then((results: Array<{id: string, name: string, skins?: Array<{native?: string}>}>) => {
            if (cancelled) {
                return
            }
            const found = (results || []).
                slice(0, MAX_EMOJI_SUGGESTIONS).
                map((e): EmojiResult => ({id: e.id, name: e.name, colons: `:${e.id}:`, native: e.skins?.[0]?.native || ''})).
                filter((e) => Boolean(e.native))
            setOptions(found)
        })
    }))

    const onSelectOption = (
        selected: EmojiResult,
        nodeToReplace: TextNode | null,
        closeMenu: () => void,
    ) => {
        // Already inside editor.update() — the menu runs the selection there.
        const emojiText = `${selected.native} `
        const newNode = $createTextNode(emojiText)
        if (nodeToReplace && nodeToReplace.isAttached()) {
            nodeToReplace.replace(newNode)
            newNode.selectNext(0, 0)
        } else {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
                selection.insertText(emojiText)
            }
        }
        closeMenu()
    }

    return (
        <TypeaheadMenu<EmojiResult>
            editor={props.editor}
            options={options()}
            triggerFn={triggerFn}
            class='MarkdownEditorInput--emojis'
            onQueryChange={setQuery}
            onSelectOption={onSelectOption}
            itemRender={(emoji, isSelected, select, highlight) => (
                <div
                    role='option'
                    aria-selected={isSelected()}
                    class={`EmojiEntry ${isSelected() ? 'EmojiEntry--selected' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={highlight}
                    onClick={select}
                >
                    <span class='EmojiEntry__native'>{emoji.native}</span>
                    <span class='EmojiEntry__colons'>{emoji.colons}</span>
                </div>
            )}
        />
    )
}

export default EmojiPlugin
