import {createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

type TextInputOptionProps = {
    initialValue: string
    onConfirmValue: (value: string) => void
    onValueChanged: (value: string) => void
}

function TextInputOption(props: TextInputOptionProps): JSX.Element {
    let nameTextbox: HTMLInputElement | undefined
    const [value, setValue] = createSignal(props.initialValue)

    onMount(() => {
        nameTextbox?.focus()
        nameTextbox?.setSelectionRange(0, value().length)
    })

    return (
        <input
            ref={nameTextbox}
            type='text'
            class='PropertyMenu menu-textbox menu-option'
            onClick={(e) => e.stopPropagation()}
            onInput={(e) => {
                // The React version reported the value captured before this
                // keystroke — one behind — and something may lean on that.
                const previous = value()
                setValue((e.target as HTMLInputElement).value)
                props.onValueChanged(previous)
            }}
            value={value()}
            title={value()}
            onBlur={() => props.onConfirmValue(value())}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    props.onConfirmValue(value())
                    e.stopPropagation()
                    if (e.key === 'Enter') {
                        (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                    }
                }
            }}
            spellcheck={true}
        />
    )
}

export default TextInputOption
