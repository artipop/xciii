import {Show, createEffect, createSignal, on} from 'solid-js'

import {useIntl} from '../../intl'

import {MCPServers, mcpServersPlaceholder, serversToText, textToServers} from './mcpServers'

import './mcpField.scss'

// The MCP servers a column or a stage hands its agent, as the block every MCP
// client takes. The same question «Настройки → Агенты» asks of an agent, asked
// here of the place the work happens: one agent works «В работе» and «QA», and
// only the second of them needs a browser.
//
// Folded, because it is ten lines of JSON that are right almost always and read
// almost never — the shape PromptField already has for the same reason. What
// keeps the fold honest is the summary: it names the servers behind it, so
// nothing has to be opened to find out whether there are any.

type Props = {

    // Which owner this field is editing. The panel keeps one component for
    // every stage it shows, so the text is reset when this changes and never
    // while somebody is typing into it.
    owner: string

    label: string
    value?: MCPServers

    // What the field says when it is empty: for a stage, the column's answer.
    emptySummary: string

    onChange: (servers: MCPServers | undefined) => void
}

const MCPField = (props: Props) => {
    const intl = useIntl()
    const [text, setText] = createSignal('')
    const [error, setError] = createSignal('')

    // `on` tracks its first argument and nothing the body reads, which is the
    // whole reason it is used here: the box is filled from the servers when the
    // panel moves to another stage, and never while somebody is typing — a
    // value re-serialized under the cursor is a field that reformats what it
    // is being told.
    createEffect(on(() => props.owner, () => {
        setText(serversToText(props.value))
        setError('')
    }))

    const names = () => Object.keys(props.value || {})

    // Read on the way out rather than on every keystroke: half-typed JSON is
    // not a mistake, it is the middle of typing.
    const commit = (raw: string) => {
        setText(raw)
        if (!raw.trim()) {
            setError('')
            props.onChange(undefined)
            return
        }
        try {
            const servers = textToServers(raw)
            setError('')
            props.onChange(Object.keys(servers).length > 0 ? servers : undefined)
        } catch {
            setError(intl.formatMessage({id: 'Automation.mcp-invalid', defaultMessage: 'This is not the JSON an MCP client takes: a server name with its command and args. Nothing was saved.'}))
        }
    }

    return (
        <details class='MCPField'>
            <summary>
                {props.label}
                <span class='MCPField__summary'>
                    {names().length > 0 ? names().join(', ') : props.emptySummary}
                </span>
            </summary>
            <div class='MCPField__body'>
                <textarea
                    rows={8}
                    value={text()}
                    placeholder={mcpServersPlaceholder}
                    aria-label={props.label}
                    onChange={(e) => commit(e.currentTarget.value)}
                />
                <Show when={error()}>
                    <span class='MCPField__error'>{error()}</span>
                </Show>
                <span class='MCPField__hint'>
                    {intl.formatMessage({id: 'Automation.mcp-hint', defaultMessage: 'These are added to the servers the agent itself carries, and their tools run without confirmation prompts.'})}
                </span>
            </div>
        </details>
    )
}

export default MCPField
