// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onMount} from 'solid-js'

import {BlockInputProps, ContentType} from '../types'
import {Utils} from '../../../../utils'

import './text.scss'

const Text: ContentType = {
    name: 'text',
    displayName: 'Text',
    slashCommand: '/text',
    prefix: '',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps) => {
        return (
            <div
                innerHTML={Utils.htmlFromMarkdown(props.value || '')}
                class={props.value ? 'octo-editor-preview' : 'octo-editor-preview octo-placeholder'}
            />
        )
    },
    Input: (props: BlockInputProps) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.focus()
        })
        return (
            <input
                ref={ref}
                class='Text'
                onInput={(e) => props.onChange(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (props.value === '' && e.key === 'Backspace') {
                        props.onCancel()
                    }
                    if (e.key === 'Enter') {
                        props.onSave(props.value)
                    }
                }}
                value={props.value}
            />
        )
    },
}

Text.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(Text)
    changeValue(args.join(' '))
}

export default Text
