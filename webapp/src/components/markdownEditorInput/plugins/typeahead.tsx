// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Solid replacement for @lexical/react's LexicalTypeaheadMenuPlugin,
// reduced to what the mentions and emoji typeaheads use: watch the text before
// the caret for a trigger, report the query, draw the options in a floating
// list at the caret, and let the keyboard drive it while it is open. The
// trigger matching and the query-node split are ports of the original
// (MIT, Meta Platforms); the positioning is @floating-ui/dom, which is what
// the rest of this codebase floats menus with.

import {For, Show, createEffect, createMemo, createSignal, onCleanup, onMount} from 'solid-js'
import type {JSX} from 'solid-js'
import {Portal} from 'solid-js/web'
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom'
import {
    $getSelection,
    $isRangeSelection,
    $isTextNode,
    COMMAND_PRIORITY_LOW,
    KEY_ARROW_DOWN_COMMAND,
    KEY_ARROW_UP_COMMAND,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_TAB_COMMAND,
    LexicalEditor,
    RangeSelection,
    TextNode,
} from 'lexical'
import {mergeRegister} from '@lexical/utils'

export type MenuTextMatch = {
    leadOffset: number
    matchingString: string
    replaceableString: string
}

export type TriggerFn = (text: string) => MenuTextMatch | null

const PUNCTUATION = '\\.,\\+\\*\\?\\$\\@\\|#{}\\(\\)\\^\\-\\[\\]\\\\/!%\'"~=<>_:;'

// A trigger character followed by a query, preceded by whitespace or the start
// of the line — @lexical/react's useBasicTypeaheadTriggerMatch without the hook.
export function basicTypeaheadTriggerMatch(
    trigger: string,
    {minLength = 1, maxLength = 75}: {minLength?: number, maxLength?: number},
): TriggerFn {
    return (text: string) => {
        const validChars = '[^' + trigger + PUNCTUATION + '\\s]'
        const typeaheadTriggerRegex = new RegExp(
            '(^|\\s|\\()(' +
            '[' + trigger + ']' +
            '((?:' + validChars + '){0,' + maxLength + '})' +
            ')$',
        )
        const match = typeaheadTriggerRegex.exec(text)
        if (match !== null) {
            const maybeLeadingWhitespace = match[1]
            const matchingString = match[3]
            if (matchingString.length >= minLength) {
                return {
                    leadOffset: match.index + maybeLeadingWhitespace.length,
                    matchingString,
                    replaceableString: match[2],
                }
            }
        }
        return null
    }
}

function getTextUpToAnchor(selection: RangeSelection): string | null {
    const anchor = selection.anchor
    if (anchor.type !== 'text') {
        return null
    }
    const anchorNode = anchor.getNode()
    if (!anchorNode.isSimpleText()) {
        return null
    }
    return anchorNode.getTextContent().slice(0, anchor.offset)
}

// How much of the text before the caret the match actually covers, so a query
// typed over an earlier partial insertion is replaced whole.
function getFullMatchOffset(documentText: string, entryText: string, offset_: number): number {
    let triggerOffset = offset_
    for (let i = triggerOffset; i <= entryText.length; i++) {
        if (documentText.slice(-i) === entryText.substring(0, i)) {
            triggerOffset = i
        }
    }
    return triggerOffset
}

// Split the text node around the query so the caller can replace exactly the
// trigger-plus-query with the chosen text. Must run inside editor.update().
function $splitNodeContainingQuery(match: MenuTextMatch): TextNode | null {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return null
    }
    const anchor = selection.anchor
    if (anchor.type !== 'text') {
        return null
    }
    const anchorNode = anchor.getNode()
    if (!anchorNode.isSimpleText()) {
        return null
    }
    const selectionOffset = anchor.offset
    const textContent = anchorNode.getTextContent().slice(0, selectionOffset)
    const characterOffset = match.replaceableString.length
    const queryOffset = getFullMatchOffset(textContent, match.matchingString, characterOffset)
    const startOffset = selectionOffset - queryOffset
    if (startOffset < 0) {
        return null
    }
    let newNode
    if (startOffset === 0) {
        [newNode] = anchorNode.splitText(selectionOffset)
    } else {
        [, newNode] = anchorNode.splitText(startOffset, selectionOffset)
    }
    return newNode
}

// The caret does not begin a query when it sits right after a text entity
// (a finished mention), which is what typing "@a" directly after "@b" is.
function $isSelectionOnEntityBoundary(offset_: number): boolean {
    if (offset_ !== 0) {
        return false
    }
    const selection = $getSelection()
    if ($isRangeSelection(selection)) {
        const prevSibling = selection.anchor.getNode().getPreviousSibling()
        return $isTextNode(prevSibling) && prevSibling.isTextEntity()
    }
    return false
}

type Resolution = {
    match: MenuTextMatch
    getRect: () => DOMRect
}

type Props<T> = {
    editor: LexicalEditor
    options: T[]
    triggerFn: TriggerFn
    class: string
    onQueryChange: (query: string | null) => void
    onSelectOption: (option: T, nodeToReplace: TextNode | null, closeMenu: () => void) => void
    // selected is an accessor so a row's highlight updates in place inside <For>.
    itemRender: (option: T, selected: () => boolean, select: () => void, highlight: () => void) => JSX.Element
}

export function TypeaheadMenu<T>(props: Props<T>): JSX.Element {
    const [resolution, setResolution] = createSignal<Resolution | null>(null)
    const [highlightedIndex, setHighlightedIndex] = createSignal(0)

    // Clamped rather than reset when the options list shrinks under the caret.
    const selectedIndex = createMemo(() => Math.min(Math.max(props.options.length - 1, 0), highlightedIndex()))

    const close = () => setResolution(null)

    onMount(() => {
        const editor = props.editor
        const unregister = mergeRegister(
            editor.registerUpdateListener(() => {
                editor.getEditorState().read(() => {
                    if (editor.isComposing()) {
                        return
                    }
                    const selection = $getSelection()
                    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
                        close()
                        return
                    }
                    const text = getTextUpToAnchor(selection)
                    if (text === null) {
                        close()
                        return
                    }
                    const match = props.triggerFn(text)
                    props.onQueryChange(match ? match.matchingString : null)

                    if (match !== null && !$isSelectionOnEntityBoundary(match.leadOffset)) {
                        const domSelection = window.getSelection()
                        if (domSelection && domSelection.isCollapsed && domSelection.anchorNode) {
                            const range = document.createRange()
                            try {
                                range.setStart(domSelection.anchorNode, match.leadOffset)
                                range.setEnd(domSelection.anchorNode, domSelection.anchorOffset)
                            } catch (e) {
                                close()
                                return
                            }
                            setHighlightedIndex(0)
                            setResolution({match, getRect: () => range.getBoundingClientRect()})
                            return
                        }
                    }
                    close()
                })
            }),
            editor.registerEditableListener((isEditable) => {
                if (!isEditable) {
                    close()
                }
            }),
        )
        onCleanup(unregister)
    })

    const selectOptionAndCleanUp = (option: T) => {
        const res = resolution()
        props.editor.update(() => {
            const nodeToReplace = res ? $splitNodeContainingQuery(res.match) : null
            props.onSelectOption(option, nodeToReplace, close)
        })
    }

    // The keyboard drives the menu only while it is open and has options; the
    // registrations come and go with it so the editor keeps its own keymap
    // the rest of the time.
    createEffect(() => {
        if (!resolution() || props.options.length === 0) {
            return
        }
        const editor = props.editor
        const unregister = mergeRegister(
            editor.registerCommand<KeyboardEvent>(
                KEY_ARROW_DOWN_COMMAND,
                (event) => {
                    setHighlightedIndex(selectedIndex() === props.options.length - 1 ? 0 : selectedIndex() + 1)
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent>(
                KEY_ARROW_UP_COMMAND,
                (event) => {
                    setHighlightedIndex(selectedIndex() === 0 ? props.options.length - 1 : selectedIndex() - 1)
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent>(
                KEY_ESCAPE_COMMAND,
                (event) => {
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    close()
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent>(
                KEY_TAB_COMMAND,
                (event) => {
                    event.preventDefault()
                    event.stopImmediatePropagation()
                    selectOptionAndCleanUp(props.options[selectedIndex()])
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent | null>(
                KEY_ENTER_COMMAND,
                (event) => {
                    // Shift+Enter stays a line break.
                    if (event && event.shiftKey) {
                        return false
                    }
                    if (event !== null) {
                        event.preventDefault()
                        event.stopImmediatePropagation()
                    }
                    selectOptionAndCleanUp(props.options[selectedIndex()])
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
        )
        onCleanup(unregister)
    })

    // The list floats at the caret: the resolution's live range is the virtual
    // reference, flip/shift keep it on screen.
    let menuRef: HTMLDivElement | undefined
    createEffect(() => {
        const res = resolution()
        const floating = menuRef
        if (!res || props.options.length === 0 || !floating) {
            return
        }
        const reference = {getBoundingClientRect: res.getRect}
        const stop = autoUpdate(reference, floating, () => {
            computePosition(reference, floating, {
                placement: 'bottom-start',
                middleware: [offset(4), flip(), shift({padding: 8})],
            }).then(({x, y}) => {
                floating.style.left = `${x}px`
                floating.style.top = `${y}px`
            })
        })
        onCleanup(stop)
    })

    return (
        <Show when={resolution() && props.options.length > 0}>
            <Portal>
                <div
                    ref={menuRef}
                    class={props.class}
                    style={{position: 'absolute', top: '0', left: '0', 'z-index': 999}}
                >
                    <div role='listbox'>
                        <For each={props.options}>
                            {(option, i) => props.itemRender(
                                option,
                                () => selectedIndex() === i(),
                                () => {
                                    setHighlightedIndex(i())
                                    selectOptionAndCleanUp(option)
                                },
                                () => setHighlightedIndex(i()),
                            )}
                        </For>
                    </div>
                </div>
            </Portal>
        </Show>
    )
}
