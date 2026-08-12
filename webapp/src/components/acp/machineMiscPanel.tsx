// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, createSignal, onMount} from 'solid-js'

import {useIntl} from '../../intl'

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
    const [worktrees, setWorktrees] = createSignal('')
    const [error, setError] = createSignal('')

    onMount(async () => {
        try {
            if (bindings?.GetPlanningPrompt) {
                const stored = await bindings.GetPlanningPrompt()
                setPrompt(stored)
                setSavedPrompt(stored)
            }
            if (bindings?.GetWorktreeMode) {
                setWorktrees(await bindings.GetWorktreeMode())
            }
        } catch (e: any) {
            setError(String(e?.message || e))
        }
    })

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
                    the card. This is only about interrupting, which is why it
                    is a setting at all, and why it is offered only where there
                    is an agent that could ask. */}
                <Show when={isAgentsAvailable()}>
                    <div class='MachineMiscPanel__setting'>
                        <div class='MachineMiscPanel__fact'>
                            <span class='MachineMiscPanel__factName'>
                                {intl.formatMessage({id: 'Sidebar.agent-notifications', defaultMessage: 'Notify me when an agent is waiting'})}
                            </span>
                            <span class='MachineMiscPanel__factValue'>
                                {intl.formatMessage({
                                    id: 'Machine.agent-notifications-hint',
                                    defaultMessage: 'The question itself is in the notification, and answering it there is answering the agent. The amber dot on the card stays either way.',
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

                <Show when={worktrees()}>
                    <div class='MachineMiscPanel__fact'>
                        <span class='MachineMiscPanel__factName'>
                            {intl.formatMessage({id: 'Machine.worktrees', defaultMessage: 'A session gets a git worktree of its own'})}
                        </span>
                        <span class='MachineMiscPanel__factValue'>
                            {worktrees() === 'always' ? intl.formatMessage({id: 'Machine.worktrees-always', defaultMessage: 'yes — agents can work several cards of one project at once'}) : intl.formatMessage({id: 'Machine.worktrees-never', defaultMessage: 'no — one card of a project at a time, in the folder itself'})}
                        </span>
                    </div>
                </Show>

                <p class='MachineMiscPanel__hint'>
                    {intl.formatMessage({
                        id: 'Machine.hint-config',
                        defaultMessage: 'How many sessions run at once, how long a turn may take, which tools an agent may use without asking — those are edited by hand in the app\'s config.json, and are described in docs/flows.md.',
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
