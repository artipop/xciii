import {onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import './editable.scss'

export type EditableProps = {
    onChange: (value: string) => void
    value?: string
    placeholderText?: string
    class?: string
    saveOnEsc?: boolean
    readonly?: boolean
    spellCheck?: boolean
    autoExpand?: boolean

    validator?: (value: string) => boolean
    onCancel?: () => void
    onSave?: (saveType: 'onEnter'|'onEsc'|'onBlur') => void
    onFocus?: () => void

    // What useImperativeHandle exposed under React: callers pass a callback
    // ref and keep the Focusable it receives.
    ref?: (focusable: Focusable) => void
}

export type Focusable = {
    focus: (selectAll?: boolean) => void
}

export type ElementType = HTMLInputElement | HTMLTextAreaElement

export type ElementProps = {
    class: string
    placeholder?: string
    onInput: (e: Event) => void
    value?: string
    title?: string
    onBlur: () => void
    onKeyDown: (e: KeyboardEvent) => void
    readOnly?: boolean
    spellcheck?: boolean
    onFocus?: () => void
}

// The shared half of Editable and EditableArea. The returned object carries
// getters, so a spread into the element stays live; onInput is what React's
// per-keystroke onChange compiles to in a real DOM.
export function useEditable(
    props: EditableProps,
    element: () => ElementType | undefined): ElementProps {
    let saveOnBlur = true

    const save = (saveType: 'onEnter'|'onEsc'|'onBlur'): void => {
        if (props.validator && !props.validator(props.value || '')) {
            return
        }
        if (!props.onSave) {
            return
        }
        if (saveType === 'onBlur' && !saveOnBlur) {
            return
        }
        if (saveType === 'onEsc' && !props.saveOnEsc) {
            return
        }
        props.onSave(saveType)
    }

    props.ref?.({
        focus: (selectAll = false): void => {
            const el = element()
            if (el) {
                const valueLength = el.value.length
                el.focus()
                if (selectAll) {
                    el.setSelectionRange(0, valueLength)
                } else {
                    el.setSelectionRange(valueLength, valueLength)
                }
            }
        },
    })

    const blur = (): void => {
        saveOnBlur = false
        element()?.blur()
        saveOnBlur = true
    }

    return {
        get class() {
            const error = props.validator ? !props.validator(props.value || '') : false
            return 'Editable ' + (error ? 'error ' : '') + (props.readonly ? 'readonly ' : '') + (props.class || '')
        },
        get placeholder() {
            return props.placeholderText
        },
        onInput: (e: Event) => {
            props.onChange((e.target as ElementType).value)
        },
        get value() {
            return props.value
        },
        get title() {
            return props.value
        },
        onBlur: () => save('onBlur'),
        onKeyDown: (e: KeyboardEvent): void => {
            if (e.keyCode === 27 && !(e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) { // ESC
                e.preventDefault()
                if (props.saveOnEsc) {
                    save('onEsc')
                } else {
                    props.onCancel?.()
                }
                blur()
            } else if (e.keyCode === 13 && !(e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) { // Return
                e.preventDefault()
                save('onEnter')
                blur()
            }
        },
        get readOnly() {
            return props.readonly
        },
        get spellcheck() {
            return props.spellCheck
        },
        get onFocus() {
            return props.onFocus
        },
    }
}

const Editable = (props: EditableProps): JSX.Element => {
    let elementRef: HTMLInputElement | undefined
    const elementProps = useEditable(props, () => elementRef)

    onMount(() => {
        if (props.autoExpand && elementRef) {
            elementRef.style.width = '100%'
        }
    })

    return (
        <input
            {...elementProps}
            ref={elementRef}
        />
    )
}

export default Editable
