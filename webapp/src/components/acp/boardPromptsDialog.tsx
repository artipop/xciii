// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './bindings'
import PromptField from './promptField'

import './boardPromptsDialog.scss'

// What this board's agents are told before anything else — the system prompt of
// the board, on its own screen.
//
// It was a fold at the bottom of «Как работает эта доска…», under the route
// canvas, which is the wrong place twice over: what an agent is told is not a
// question about columns and arrows, and a fold under a canvas is somewhere
// nobody scrolls to. The board's ⋯ menu asks each of the board's questions in
// its own item («Папки…», «Куда деплоить…»), and this is one of them.
//
// Two layers, because they answer two questions: the board's own text goes to
// every agent working here, and each agent may be given a text of its own for
// this board — «клаус пишет тесты, кодекс только ревьюит». What an agent is
// like on *every* board is a third thing and stays in the registry
// («Настройки → Агенты»), where the agent itself is.

export function isBoardPromptsAvailable(): boolean {
    return Boolean(agentBindings()?.GetBoardPrompts)
}

type Brief = {
    board?: string
    agents?: Record<string, string>
}

type Props = {
    board: Board
    onClose: () => void
}

const BoardPromptsDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [board, setBoard] = createSignal('')
    const [agents, setAgents] = createSignal<Record<string, string>>({})
    const [names, setNames] = createSignal<string[]>([])
    const [error, setError] = createSignal('')
    const [saving, setSaving] = createSignal(false)

    onMount(async () => {
        try {
            if (bindings?.GetBoardPrompts) {
                const brief: Brief = JSON.parse(await bindings.GetBoardPrompts(props.board.id)) || {}
                setBoard(brief.board || '')
                setAgents(brief.agents || {})
            }
            if (bindings?.ListAgents) {
                const registered: Array<{name: string}> = JSON.parse(await bindings.ListAgents()) || []
                setNames(registered.map((a) => a.name))
            }
        } catch (e) {
            setError(String(e))
        }
    })

    // An agent the board has something to say to but this machine has no entry
    // for is still listed: the text came with the board, and hiding it would be
    // this machine quietly dropping what another machine set up.
    const listed = () => {
        const all = [...names()]
        for (const name of Object.keys(agents())) {
            if (!all.includes(name)) {
                all.push(name)
            }
        }
        return all
    }

    const setAgentText = (name: string, text: string) => {
        setAgents({...agents(), [name]: text})
    }

    const save = async () => {
        if (!bindings?.SetBoardPrompts) {
            return
        }
        setError('')
        setSaving(true)
        try {
            await bindings.SetBoardPrompts(props.board.id, JSON.stringify({board: board(), agents: agents()}))
            props.onClose()
        } catch (e) {
            setError(String(e))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog
            class='BoardPromptsDialog'
            title={<span>{intl.formatMessage({id: 'BoardPrompts.title', defaultMessage: 'The board’s system prompt'})}</span>}
            subtitle={<span>{intl.formatMessage({id: 'BoardPrompts.subtitle', defaultMessage: 'Said first to every agent that works on this board — in a session a column starts, and in a conversation somebody opens.'})}</span>}
            onClose={props.onClose}
        >
            <div class='BoardPromptsDialog__content'>
                <label class='BoardPromptsDialog__board'>
                    {intl.formatMessage({id: 'BoardPrompts.board', defaultMessage: 'To every agent of this board'})}
                    <textarea
                        rows={6}
                        value={board()}
                        placeholder={intl.formatMessage({id: 'BoardPrompts.board-placeholder', defaultMessage: 'What this board is about, and how work is done on it'})}
                        onInput={(e) => setBoard(e.currentTarget.value)}
                    />
                </label>

                <div class='BoardPromptsDialog__agents'>
                    <div class='BoardPromptsDialog__sectionTitle'>
                        {intl.formatMessage({id: 'BoardPrompts.agents', defaultMessage: 'To one agent, on this board'})}
                    </div>
                    <Show
                        when={listed().length > 0}
                        fallback={
                            <p class='BoardPromptsDialog__hint'>
                                {intl.formatMessage({id: 'BoardPrompts.no-agents', defaultMessage: 'No agents registered yet — "Settings → Agents".'})}
                            </p>
                        }
                    >
                        <p class='BoardPromptsDialog__hint'>
                            {intl.formatMessage({id: 'BoardPrompts.agents-hint', defaultMessage: 'Added after the text above and after the agent’s own prompt, which holds on every board. This one is about this board only.'})}
                        </p>
                        <For each={listed()}>
                            {(name) => (
                                <PromptField
                                    label={agents()[name]?.trim() ?
                                        intl.formatMessage({id: 'BoardPrompts.agent-set', defaultMessage: '{name} — set'}, {name}) :
                                        name}
                                    value={agents()[name] || ''}
                                    rows={5}
                                    placeholder={intl.formatMessage({id: 'BoardPrompts.agent-placeholder', defaultMessage: 'What this agent does on this board'})}
                                    onInput={(text) => setAgentText(name, text)}
                                />
                            )}
                        </For>
                    </Show>
                </div>

                <div class='BoardPromptsDialog__actions'>
                    <Button
                        emphasis='primary'
                        onClick={save}
                        disabled={saving()}
                    >
                        {intl.formatMessage({id: 'BoardPrompts.save', defaultMessage: 'Save'})}
                    </Button>
                    <Button onClick={props.onClose}>
                        {intl.formatMessage({id: 'BoardPrompts.cancel', defaultMessage: 'Cancel'})}
                    </Button>
                </div>

                <Show when={error()}>
                    <div class='BoardPromptsDialog__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

export default BoardPromptsDialog
