import {onMount} from 'solid-js'
import {marked} from 'marked'

import {BlockInputProps, ContentType} from '../types'

import './h1.scss'

const H1: ContentType = {
    name: 'h1',
    displayName: 'Title',
    slashCommand: '/title',
    prefix: '# ',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps) => {
        const renderer = new marked.Renderer()
        return (
            <div
                innerHTML={marked('# ' + props.value, {renderer, breaks: true}).trim()}
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
                class='H1'
                data-testid='h1'
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

H1.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(H1)
    changeValue(args.join(' '))
}

export default H1
