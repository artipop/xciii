// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'
import {Dynamic} from 'solid-js/web'
import type {Component} from 'solid-js'

import {useIntl} from '../../intl'

import Dialog from '../dialog'

import AgentsPanel, {isAgentsAvailable} from './agentsPanel'
import DeployTargetsPanel, {isDeployTargetsAvailable} from './deployTargetsPanel'
import ProxiesPanel, {isProxiesAvailable} from './proxiesPanel'
import TailnetPanel, {isTailnetAvailable} from './tailnetPanel'
import MachineMiscPanel from './machineMiscPanel'
import {agentBindings} from './bindings'

import './machineSettingsDialog.scss'

// Everything this app knows that is true of the machine rather than of a board:
// which agents are installed, where they may deploy, how they reach the network,
// whether the board is on the tailnet.
//
// All of it used to be reached through a board's ⋯ menu, which put machine
// settings behind a board and made them unreachable when none was open. They
// are the sidebar's business, beside the theme and the language, and one dialog
// with a list down the side is what keeps them one thing rather than five menu
// entries.

export function isMachineSettingsAvailable(): boolean {
    return Boolean(agentBindings()?.ListAgents)
}

type Section = {
    id: string
    name: string
    when: () => boolean

    // A component, not rendered JSX: switching sections has to build the panel
    // again, because a panel reads its registry when it mounts and that is how
    // it picks up what another section just changed.
    body: Component
}

type Props = {
    onClose: () => void
}

const MachineSettingsDialog = (props: Props) => {
    const intl = useIntl()

    const sections: Section[] = [
        {
            id: 'agents',
            name: intl.formatMessage({id: 'Machine.section-agents', defaultMessage: 'Agents'}),
            when: isAgentsAvailable,
            body: AgentsPanel,
        },
        {
            id: 'deploys',
            name: intl.formatMessage({id: 'Machine.section-deploys', defaultMessage: 'Where to deploy'}),
            when: isDeployTargetsAvailable,
            body: DeployTargetsPanel,
        },
        {
            id: 'proxies',
            name: intl.formatMessage({id: 'Proxies.title', defaultMessage: 'Proxy configurations'}),
            when: isProxiesAvailable,
            body: ProxiesPanel,
        },
        {
            id: 'tailnet',
            name: intl.formatMessage({id: 'Tailnet.title', defaultMessage: 'Access from a phone'}),
            when: isTailnetAvailable,
            body: TailnetPanel,
        },
        {
            id: 'misc',
            name: intl.formatMessage({id: 'Machine.section-misc', defaultMessage: 'Other'}),
            when: () => true,
            body: MachineMiscPanel,
        },
    ]

    const offered = () => sections.filter((s) => s.when())
    const [current, setCurrent] = createSignal(offered()[0]?.id || 'misc')
    const section = () => offered().find((s) => s.id === current()) || offered()[0]

    return (
        <Dialog
            class='MachineSettingsDialog'
            title={<span>{intl.formatMessage({id: 'Machine.title', defaultMessage: 'This machine'})}</span>}
            onClose={props.onClose}
        >
            <div class='MachineSettingsDialog__body'>
                <nav class='MachineSettingsDialog__nav'>
                    <For each={offered()}>
                        {(entry) => (
                            <button
                                type='button'
                                class={`MachineSettingsDialog__navItem${entry.id === current() ? ' MachineSettingsDialog__navItem--current' : ''}`}
                                onClick={() => setCurrent(entry.id)}
                            >
                                {entry.name}
                            </button>
                        )}
                    </For>
                </nav>
                <div class='MachineSettingsDialog__panel'>
                    <Show when={section()}>
                        {(entry) => (
                            <>
                                <h3 class='MachineSettingsDialog__panelTitle'>{entry().name}</h3>
                                <Dynamic component={entry().body}/>
                            </>
                        )}
                    </Show>
                </div>
            </div>
        </Dialog>
    )
}

export default MachineSettingsDialog
