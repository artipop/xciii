import {onMount} from 'solid-js'

import {BlockInputProps, ContentType} from '../types'

import './list-item.scss'

const ListItem: ContentType = {
    name: 'list-item',
    displayName: 'List item',
    slashCommand: '/list-item',
    prefix: '* ',
    nextType: 'list-item',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps) => <ul><li>{props.value}</li></ul>,
    Input: (props: BlockInputProps) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.focus()
        })
        return (
            <ul>
                <li>
                    <input
                        ref={ref}
                        class='ListItem'
                        data-testid='list-item'
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
                </li>
            </ul>
        )
    },
}

ListItem.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(ListItem)
    changeValue(args.join(' '))
}

export default ListItem
