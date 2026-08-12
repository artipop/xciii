import {onCleanup, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {registerPlainText} from '@lexical/plain-text'
import {createEmptyHistoryState, registerHistory} from '@lexical/history'
import {mergeRegister} from '@lexical/utils'
import {
    $getRoot,
    BLUR_COMMAND,
    COMMAND_PRIORITY_LOW,
    FOCUS_COMMAND,
    KEY_BACKSPACE_COMMAND,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    createEditor,
} from 'lexical'

import {Utils} from '../../utils'

import {$rebuildStyledContent, $setEditorMarkdown, registerLiveMarkdown} from '../live-markdown-plugin/liveMarkdown'

import MentionsPlugin from './plugins/mentionsPlugin'
import EmojiPlugin from './plugins/emojiPlugin'

import './markdownEditorInput.scss'

type Props = {
    onChange?: (text: string) => void
    onFocus?: () => void
    onBlur?: (text: string) => void
    onEditorCancel?: () => void
    initialText?: string
    id?: string
    isEditing: boolean
    saveOnEnter?: boolean
}

// What @lexical/react's HistoryPlugin used between batches of changes.
const HISTORY_MERGE_DELAY = 300

// The Lexical editor without its React bindings: one editor instance per
// component, the plain-text and history behaviours registered directly from
// their headless packages, and the board-facing keyboard contract (Esc → blur,
// Enter → save, Backspace on empty → cancel) as plain commands.
const MarkdownEditorInput = (props: Props): JSX.Element => {
    const editor = createEditor({
        namespace: props.id || 'MarkdownEditorInput',
        onError: (error: Error) => {
            Utils.logError(`Lexical editor error: ${error.message}`)
        },
        editable: true,
    })

    // What LexicalComposer's initialConfig.editorState did: the initial text is
    // set under history-merge so the first undo step is the user's own edit.
    editor.update(() => $setEditorMarkdown(props.initialText || ''), {tag: 'history-merge'})

    // Guards the blur-save while the "add user to board" confirm dialog (opened
    // from the mentions plugin) steals focus.
    const suppressBlur = {current: false}
    let lastText = props.initialText || ''

    let contentRef: HTMLDivElement | undefined

    onMount(() => {
        editor.setRootElement(contentRef!)

        const readText = () => editor.getEditorState().read(() => $getRoot().getTextContent())

        const unregister = mergeRegister(
            registerPlainText(editor),
            registerHistory(editor, createEmptyHistoryState(), HISTORY_MERGE_DELAY),
            registerLiveMarkdown(editor),

            // What OnChangePlugin with ignoreSelectionChange did: report only
            // updates that touched content, and only when the text differs.
            editor.registerUpdateListener(({editorState, dirtyElements, dirtyLeaves}) => {
                if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
                    return
                }
                const text = editorState.read(() => $getRoot().getTextContent())
                if (text !== lastText) {
                    lastText = text
                    props.onChange?.(text)
                }
            }),
            editor.registerCommand(
                KEY_ESCAPE_COMMAND,
                () => {
                    editor.blur()
                    return true
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent | null>(
                KEY_ENTER_COMMAND,
                (event) => {
                    if (props.saveOnEnter && event && !event.shiftKey) {
                        event.preventDefault()
                        props.onBlur?.(readText())
                        return true
                    }
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand<KeyboardEvent>(
                KEY_BACKSPACE_COMMAND,
                () => {
                    if (props.onEditorCancel && $getRoot().getTextContent().length === 0) {
                        props.onEditorCancel()
                        return true
                    }
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                FOCUS_COMMAND,
                () => {
                    props.onFocus?.()
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
            editor.registerCommand(
                BLUR_COMMAND,
                () => {
                    if (!suppressBlur.current) {
                        props.onBlur?.(readText())
                    }
                    return false
                },
                COMMAND_PRIORITY_LOW,
            ),
        )

        editor.update(() => $rebuildStyledContent(), {tag: 'live-markdown'})
        editor.focus()

        onCleanup(() => {
            unregister()
            editor.setRootElement(null)
        })
    })

    /*
     * TODO: undo/redo does not actually work here since the draft-js ->
     * Lexical migration (96cd8494). Ctrl/Cmd+Z is a no-op: not just after a
     * cut, but for plain typing too. Confirmed outside of test-runner
     * synthetic events, with CDP-level key presses, for both Meta+Z and
     * Ctrl+Z. registerHistory is wired above, so the cause is still unknown --
     * LiveMarkdownPlugin is the first suspect, being the one plugin that
     * rewrites content on every change. The E2E test covering this (GH-2520 in
     * cypress/e2e/createBoard.ts) is skipped until it works again.
     */

    return (
        <div class='MarkdownEditorInput'>
            <div
                ref={contentRef}
                class='MarkdownEditorInput__content'
                contenteditable={true}
                autocapitalize='off'
                role='textbox'
                spellcheck={true}
            />
            <MentionsPlugin
                editor={editor}
                suppressBlur={suppressBlur}
            />
            <EmojiPlugin editor={editor}/>
        </div>
    )
}

export default MarkdownEditorInput
