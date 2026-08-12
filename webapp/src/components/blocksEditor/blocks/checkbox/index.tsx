import {onMount} from 'solid-js'
import {marked} from 'marked'

import {BlockInputProps, ContentType} from '../types'

import './checkbox.scss'

type ValueType = {
    value: string
    checked: boolean
}

const Checkbox: ContentType<ValueType> = {
    name: 'checkbox',
    displayName: 'Checkbox',
    slashCommand: '/checkbox',
    prefix: '[ ] ',
    nextType: 'checkbox',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps<ValueType>) => {
        const renderer = new marked.Renderer()
        return (
            <div class='CheckboxView'>
                <input
                    data-testid='checkbox-check'
                    type='checkbox'
                    onChange={(e) => {
                        const newValue = {checked: Boolean(e.currentTarget.checked), value: props.value.value || ''}
                        props.onSave(newValue)
                    }}
                    checked={props.value.checked || false}
                    onClick={(e) => e.stopPropagation()}
                />
                <div
                    innerHTML={marked(props.value.value || '', {renderer, breaks: true}).trim()}
                />
            </div>
        )
    },
    Input: (props: BlockInputProps<ValueType>) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.focus()
        })
        return (
            <div class='Checkbox'>
                <input
                    type='checkbox'
                    data-testid='checkbox-check'
                    class='inputCheck'
                    onChange={(e) => {
                        let newValue = {checked: false, value: props.value.value || ''}
                        if (e.currentTarget.checked) {
                            newValue = {checked: true, value: props.value.value || ''}
                        }
                        props.onChange(newValue)
                        ref?.focus()
                    }}
                    checked={props.value.checked || false}
                />
                <input
                    ref={ref}
                    data-testid='checkbox-input'
                    class='inputText'
                    onInput={(e) => {
                        props.onChange({checked: Boolean(props.value.checked), value: e.currentTarget.value})
                    }}
                    onKeyDown={(e) => {
                        if ((props.value.value || '') === '' && e.key === 'Backspace') {
                            props.onCancel()
                        }
                        if (e.key === 'Enter') {
                            props.onSave(props.value || {checked: false, value: ''})
                        }
                    }}
                    value={props.value.value || ''}
                />
            </div>
        )
    },
}

Checkbox.runSlashCommand = (changeType: (contentType: ContentType<ValueType>) => void, changeValue: (value: ValueType) => void, ...args: string[]): void => {
    changeType(Checkbox)
    changeValue({checked: false, value: args.join(' ')})
}

export default Checkbox
