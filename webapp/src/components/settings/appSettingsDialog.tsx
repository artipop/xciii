import {For, Show, createSignal} from 'solid-js'
import {Dynamic} from 'solid-js/web'
import type {Component} from 'solid-js'

import {useIntl} from '../../intl'

import Dialog from '../dialog'

import AgentsPanel, {isAgentsAvailable} from '../acp/agentsPanel'
import ProxiesPanel, {isProxiesAvailable} from '../acp/proxiesPanel'
import TailnetPanel, {isTailnetAvailable} from '../acp/tailnetPanel'
import MachineMiscPanel from '../acp/machineMiscPanel'

import AppPanel from './appPanel'
import DataPanel from './dataPanel'
import UpdatesPanel, {isUpdatesAvailable} from './updatesPanel'

import './appSettingsDialog.scss'

// Everything this app is asked about itself rather than about a board: how it
// looks and what language it speaks, which agents are installed, how they
// reach the network, whether the board is on the tailnet, what comes in and
// goes out as an archive, and what it is allowed to interrupt with.
//
// Deploy targets are deliberately not here, although their registry is the
// machine's too: a deploy target only means anything to a board whose route
// deploys, so it is offered in that board's «Как работает эта доска…» — and a
// board of shopping lists never shows a Dokku form. What a setting depends on
// is where it is offered, even when where it is stored is the same file.
//
// All of it used to be reached through a board's ⋯ menu, which put settings
// behind a board and made them unreachable when none was open; then through the
// sidebar's own menu, where a submenu of a submenu was where a person went
// looking for an import. One dialog with a list down the side is what keeps
// them one thing rather than a menu that grows an entry per feature — and what
// emptied the corner of the board, where the theme, the language and the way to
// the manual had each become an icon standing in for a word.

// The name is an accessor, not a string, and that is the whole of why the
// language of this dialog follows the one picked inside it. A Solid component
// body runs once, so a name formatted there is a name in whatever language was
// current when the dialog opened — and the panel that changes the language is
// two clicks away, inside this very dialog. The nav and the panel heading
// stayed Russian while everything drawn inside JSX turned English.
type Section = {
    id: string
    name: () => string
    when: () => boolean

    // A component, not rendered JSX: switching sections has to build the panel
    // again, because a panel reads its registry when it mounts and that is how
    // it picks up what another section just changed.
    body: Component
}

type Props = {
    onClose: () => void
}

const AppSettingsDialog = (props: Props) => {
    const intl = useIntl()

    const sections: Section[] = [
        {

            // First, and therefore what opens: it is the one section every
            // install has something to say in, agents or no agents.
            id: 'app',
            name: () => intl.formatMessage({id: 'Settings.section-app', defaultMessage: 'The app itself'}),
            when: () => true,
            body: AppPanel,
        },
        {

            // Directly after the app itself, because it is the app talking
            // about the app — and because it is the one section that sometimes
            // has something to say before anybody comes looking.
            id: 'updates',
            name: () => intl.formatMessage({id: 'Updates.title', defaultMessage: 'Updates'}),
            when: isUpdatesAvailable,
            body: UpdatesPanel,
        },
        {
            id: 'agents',
            name: () => intl.formatMessage({id: 'Machine.section-agents', defaultMessage: 'Agents'}),
            when: isAgentsAvailable,
            body: AgentsPanel,
        },
        {
            id: 'proxies',
            name: () => intl.formatMessage({id: 'Proxies.title', defaultMessage: 'Proxy configurations'}),
            when: isProxiesAvailable,
            body: ProxiesPanel,
        },
        {
            id: 'tailnet',
            name: () => intl.formatMessage({id: 'Tailnet.title', defaultMessage: 'Access from a phone'}),
            when: isTailnetAvailable,
            body: TailnetPanel,
        },
        {
            id: 'data',
            name: () => intl.formatMessage({id: 'Settings.section-data', defaultMessage: 'Import and export'}),
            when: () => true,
            body: DataPanel,
        },
        {
            id: 'misc',
            name: () => intl.formatMessage({id: 'Machine.section-misc', defaultMessage: 'Other'}),
            when: () => true,
            body: MachineMiscPanel,
        },
    ]

    const offered = () => sections.filter((s) => s.when())
    const [current, setCurrent] = createSignal(offered()[0]?.id || 'misc')
    const section = () => offered().find((s) => s.id === current()) || offered()[0]

    return (
        <Dialog
            class='AppSettingsDialog'
            title={<span>{intl.formatMessage({id: 'Settings.title', defaultMessage: 'Settings'})}</span>}
            onClose={props.onClose}
        >
            <div class='AppSettingsDialog__body'>
                <nav class='AppSettingsDialog__nav'>
                    <For each={offered()}>
                        {(entry) => (
                            <button
                                type='button'
                                class={`AppSettingsDialog__navItem${entry.id === current() ? ' AppSettingsDialog__navItem--current' : ''}`}
                                onClick={() => setCurrent(entry.id)}
                            >
                                {entry.name()}
                            </button>
                        )}
                    </For>
                </nav>
                <div class='AppSettingsDialog__panel'>
                    <Show when={section()}>
                        {(entry) => (
                            <>
                                <h3 class='AppSettingsDialog__panelTitle'>{entry().name()}</h3>
                                <Dynamic component={entry().body}/>
                            </>
                        )}
                    </Show>
                </div>
            </div>
        </Dialog>
    )
}

export default AppSettingsDialog
