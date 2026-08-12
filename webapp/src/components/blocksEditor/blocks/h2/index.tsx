import {onMount} from 'solid-js'
import {marked} from 'marked'

import {BlockInputProps, ContentType} from '../types'

import './h2.scss'

const H2: ContentType = {
    name: 'h2',
    displayName: 'Sub title',
    slashCommand: '/subtitle',
    prefix: '## ',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps) => {
        const renderer = new marked.Renderer()
        return (
            <div
                innerHTML={marked('## ' + props.value, {renderer, breaks: true}).trim()}
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
                class='H2'
                data-testid='h2'
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

H2.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(H2)
    changeValue(args.join(' '))
}

export default H2
