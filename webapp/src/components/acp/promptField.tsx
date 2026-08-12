import type {JSX, ParentComponent} from 'solid-js'

import './promptField.scss'

// A prompt folded away. Every one of these is a long block of text that is
// right almost always and read almost never — the board's, the agent's own, the
// one a planning terminal opens with — and left open each of them buries the
// settings around it under ten lines nobody came to change.
//
// The summary is the label, so the box itself carries it as an aria-label
// rather than repeating the words on screen when it is open.

type Props = {
    label: string
    value: string
    rows?: number
    placeholder?: string
    onInput: (text: string) => void

    // What belongs under the box when it is open — a save button, a hint.
    children?: JSX.Element
}

const PromptField: ParentComponent<Props> = (props) => (
    <details class='PromptField'>
        <summary>{props.label}</summary>

        {/* Everything but the summary sits in a box of its own: a browser puts
            the content of a <details> into an anonymous box, so a flex column on
            the element itself lays out the summary and that box — and the field
            inside it came out beside its own save button, at a textarea's
            default twenty columns. */}
        <div class='PromptField__body'>
            <textarea
                rows={props.rows || 8}
                value={props.value}
                placeholder={props.placeholder}
                aria-label={props.label}
                onInput={(e) => props.onInput(e.currentTarget.value)}
            />
            {props.children}
        </div>
    </details>
)

export default PromptField
