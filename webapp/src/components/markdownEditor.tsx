// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, Suspense, createSignal, lazy} from 'solid-js'
import type {JSX} from 'solid-js'

import {Utils} from '../utils'
import './markdownEditor.scss'

const MarkdownEditorInput = lazy(() => import('./markdownEditorInput/markdownEditorInput'))

type Props = {
    id?: string
    text?: string
    placeholderText?: string
    class?: string
    readonly?: boolean

    onChange?: (text: string) => void
    onFocus?: () => void
    onBlur?: (text: string) => void
    onKeyDown?: (e: KeyboardEvent) => void
    onEditorCancel?: () => void
    autofocus?: boolean
    saveOnEnter?: boolean
}

const MarkdownEditor = (props: Props): JSX.Element => {
    const [isEditing, setIsEditing] = createSignal(Boolean(props.autofocus))
    const html = (): string => Utils.htmlFromMarkdown(props.text || props.placeholderText || '')

    const editorOnBlur = (newText: string) => {
        setIsEditing(false)
        props.onBlur && props.onBlur(newText)
    }

    return (
        <div class={`MarkdownEditor octo-editor ${props.class || ''} ${isEditing() ? 'active' : ''}`}>
            <Show
                when={isEditing()}
                fallback={
                    <div
                        data-testid='preview-element'
                        class={props.text ? 'octo-editor-preview' : 'octo-editor-preview octo-placeholder'}
                        innerHTML={html()}
                        onClick={(e) => {
                            const LINK_TAG_NAME = 'a'
                            const element = e.target as Element
                            if (element.tagName.toLowerCase() === LINK_TAG_NAME) {
                                e.stopPropagation()
                                return
                            }

                            if (!props.readonly && !isEditing()) {
                                setIsEditing(true)
                            }
                        }}
                    />
                }
            >
                <Suspense fallback={<></>}>
                    <MarkdownEditorInput
                        id={props.id}
                        onChange={props.onChange}
                        onFocus={props.onFocus}
                        onEditorCancel={props.onEditorCancel}
                        onBlur={editorOnBlur}
                        initialText={props.text}
                        isEditing={isEditing()}
                        saveOnEnter={props.saveOnEnter}
                    />
                </Suspense>
            </Show>
        </div>
    )
}

export {MarkdownEditor}
