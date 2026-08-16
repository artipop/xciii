// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {UserSettings} from '../../userSettings'
import Button from '../../widgets/buttons/button'
import Switch from '../../widgets/switch'
import {sendFlashMessage} from '../flashMessages'

import {agentBindings} from './bindings'
import {agentNotificationsOn, setAgentNotifications} from './attention'
import {isAgentsAvailable} from './agentsPanel'
import PromptField from './promptField'

import './machineMiscPanel.scss'

// The settings that belong to the install rather than to any board, and that
// have nowhere better to be: what a planning terminal opens saying, and the
// couple of facts a person needs before opening config.json by hand.
//
// The planning prompt lived in the planning dialog, beside the project and the
// agent, back when that dialog was reached from a board's menu. It is a setting
// of this machine and it is edited once, so it belongs with the other settings
// of this machine — and the dialog it left is now what it always should have
// been: a place to open a terminal.

const MachineMiscPanel = () => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [prompt, setPrompt] = createSignal('')
    const [savedPrompt, setSavedPrompt] = createSignal('')
    const [namedBranches, setNamedBranches] = createSignal(false)
    const [error, setError] = createSignal('')

    // Kept by the install rather than by Go: nothing on that side reads it —
    // the card is made by the page.
    const [prefillFolder, setPrefillFolder] = createSignal(UserSettings.prefillCardFolder)

    const togglePrefillFolder = (on: boolean) => {
        setPrefillFolder(on)
        UserSettings.prefillCardFolder = on
    }

    onMount(async () => {
        try {
            if (bindings?.GetPlanningPrompt) {
                const stored = await bindings.GetPlanningPrompt()
                setPrompt(stored)
                setSavedPrompt(stored)
            }
            if (bindings?.GetAgentNamedBranches) {
                setNamedBranches(await bindings.GetAgentNamedBranches())
            }
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    })

    // Saved on the click: it is one switch, and a Save button beside a
    // checkbox is a step for nothing.
    const toggleNamedBranches = async (on: boolean) => {
        setNamedBranches(on)
        try {
            await bindings?.SetAgentNamedBranches?.(on)
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    const savePrompt = async () => {
        if (!bindings?.SetPlanningPrompt) {
            return
        }
        setError('')
        try {
            await bindings.SetPlanningPrompt(prompt())
            setSavedPrompt(prompt())
            sendFlashMessage({
                content: intl.formatMessage({id: 'Machine.planning-prompt-saved', defaultMessage: 'Saved'}),
                severity: 'normal',
            })
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    }

    return (
        <div class='MachineMiscPanel'>
            <div class='MachineMiscPanel__subtitle'>
                {intl.formatMessage({id: 'Machine.subtitle', defaultMessage: 'Settings of this install: they apply to every board on it.'})}
            </div>
            <div class='MachineMiscPanel__content'>
                {/* The card's own indicator is not a setting — it is part of
                    the card — and neither is the dot on the tray icon, which is
                    the same indicator for somebody who is not looking at the
                    board. This is only about interrupting, which is why it is a
                    setting at all, and why it is offered only where there is an
                    agent that could ask.

                    One switch for both places the interruption reaches: the
                    notification the page draws, and — when the app is in the
                    background — the system's own, which the Go side posts and
                    reads this very setting for (alerts.go, uisettings.go). */}
                <Show when={isAgentsAvailable()}>
                    <div class='MachineMiscPanel__setting'>
                        <div class='MachineMiscPanel__fact'>
                            <span class='MachineMiscPanel__factName'>
                                {intl.formatMessage({id: 'Sidebar.agent-notifications', defaultMessage: 'Notify me when an agent is waiting'})}
                            </span>
                            <span class='MachineMiscPanel__factValue'>
                                {intl.formatMessage({
                                    id: 'Machine.agent-notifications-hint',
                                    defaultMessage: 'The notification shows the question itself, and the agent can be answered right in it; when the app is in the background it comes from the system instead. The dot on the card and the dot on the tray icon stay even with this off.',
                                })}
                            </span>
                        </div>
                        <Switch
                            isOn={agentNotificationsOn()}
                            onChanged={setAgentNotifications}
                        />
                    </div>
                </Show>

                <Show when={Boolean(bindings?.GetPlanningPrompt)}>
                    <PromptField
                        label={intl.formatMessage({
                            id: 'Machine.planning-prompt',
                            defaultMessage: 'What an agent is told when a conversation is opened without a card (the board\'s own instructions and the agent\'s come before it, the project after)',
                        })}
                        value={prompt()}

                        // Ten rows: the default instructions are eight lines,
                        // and a box that cuts off its own default reads as a
                        // bug rather than as a setting.
                        rows={10}
                        onInput={setPrompt}
                    >
                        <Show when={prompt() !== savedPrompt()}>
                            <Button onClick={savePrompt}>
                                {intl.formatMessage({id: 'Machine.save-planning-prompt', defaultMessage: 'Save the instructions'})}
                            </Button>
                        </Show>
                    </PromptField>
                </Show>

                {/* Named by the agent, spelled by the machine otherwise: the
                    switch is here because it is about how this machine spends
                    agent runs, not about any board. */}
                <label class='MachineMiscPanel__toggle'>
                    <input
                        type='checkbox'
                        checked={namedBranches()}
                        onChange={(e) => toggleNamedBranches(e.currentTarget.checked)}
                    />
                    {intl.formatMessage({id: 'Machine.named-branches', defaultMessage: 'The agent names each card’s branch'})}
                </label>
                <p class='MachineMiscPanel__hint'>
                    {intl.formatMessage({id: 'Machine.named-branches-hint', defaultMessage: 'A short agent run before the card’s first branch — no terminal opens, and a slow or odd answer falls back to the card’s title.'})}
                </p>

                {/* A default, not a rule: it writes an ordinary value onto the
                    card, which is visible and can be changed or cleared. Only
                    ever when the board offers exactly one folder — with two
                    there is a question, and nothing here is going to guess it.
                    Offered where the other agent settings are, since a board
                    with no agent has no folder field to fill. */}
                <Show when={isAgentsAvailable()}>
                    <label class='MachineMiscPanel__toggle'>
                        <input
                            type='checkbox'
                            checked={prefillFolder()}
                            onChange={(e) => togglePrefillFolder(e.currentTarget.checked)}
                        />
                        {intl.formatMessage({id: 'Machine.prefill-folder', defaultMessage: 'Fill a new card’s folder in when the board has only one'})}
                    </label>
                    <p class='MachineMiscPanel__hint'>
                        {intl.formatMessage({id: 'Machine.prefill-folder-hint', defaultMessage: 'The card gets the folder the moment it is made, and it can be changed or cleared like any other field. A board that offers several folders is never filled in — that is a question only you can answer.'})}
                    </p>
                </Show>

                {/* The guide, not docs/flows.md: this line used to name a file
                    of the source tree, which a person reading it off the
                    settings panel has no way to open. */}
                <p class='MachineMiscPanel__hint'>
                    {intl.formatMessage({
                        id: 'Machine.hint-config',
                        defaultMessage: 'How many sessions run at once, how long a turn may take, which tools an agent may use without asking — those are edited by hand in the app\'s config.json. The guide says where the file is and what is in it.',
                    })}
                </p>

                <Show when={error()}>
                    <div class='MachineMiscPanel__error'>{error()}</div>
                </Show>
            </div>
        </div>
    )
}

export default MachineMiscPanel
