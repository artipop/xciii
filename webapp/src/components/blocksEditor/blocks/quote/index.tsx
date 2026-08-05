// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onMount} from 'solid-js'
import {marked} from 'marked'

import {BlockInputProps, ContentType} from '../types'

import './quote.scss'

const Quote: ContentType = {
    name: 'quote',
    displayName: 'Quote',
    slashCommand: '/quote',
    prefix: '> ',
    Display: (props: BlockInputProps) => {
        const renderer = new marked.Renderer()
        return (
            <div
                class='Quote'
                data-testid='quote'
                innerHTML={marked('> ' + props.value, {renderer, breaks: true}).trim()}
            />
        )
    },
    runSlashCommand: (): void => {},
    editable: true,
    Input: (props: BlockInputProps) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.focus()
        })
        return (
            <blockquote
                class='Quote'
            >
                <input
                    ref={ref}
                    data-testid='quote'
                    onInput={(e) => props.onChange(e.currentTarget.value)}
                    onKeyDown={(e) => {
                        if (props.value === '' && e.key === 'Backspace') {
                            props.onCancel()
                        }
                        if (e.key === 'Enter') {
                            props.onSave(props.value)
                        }
                    }}
                    onBlur={() => props.onSave(props.value)}
                    value={props.value}
                />
            </blockquote>
        )
    },
}

Quote.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(Quote)
    changeValue(args.join(' '))
}

export default Quote
