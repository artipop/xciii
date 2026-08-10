// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Archiver} from '../../archiver'
import {
    darkThemeName,
    lightThemeName,
    setTheme,
    systemThemeName,
    ThemeName,
} from '../../theme'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {getCurrentTeam, Team} from '../../store/teams'

import './sidebarSettingsMenu.scss'
import CheckIcon from '../../widgets/icons/check'
import {Constants} from '../../constants'

import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'
import {agentNotificationsOn, setAgentNotifications} from '../acp/attention'
import MachineSettingsDialog, {isMachineSettingsAvailable} from '../acp/machineSettingsDialog'

type Props = {
    activeTheme: string
}

const SidebarSettingsMenu = (props: Props) => {
    const intl = useIntl()
    const {actions} = useAppStore()
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)

    // we need this as the sidebar doesn't always need to re-render
    // on theme change. This can cause props and the actual
    // active theme can go out of sync
    const [themeName, setThemeName] = createSignal(props.activeTheme)

    const updateTheme = (name: ThemeName) => {
        setTheme(name)
        setThemeName(name)
    }

    // Which agents are installed, where they deploy, how they reach the network
    // and where the board is reachable from are all properties of this machine,
    // not of the board somebody happens to have open — so they live here, with
    // the theme and the language, rather than in a board's own menu.
    const [showMachine, setShowMachine] = createSignal(false)

    // Spelled out rather than built as `Sidebar.${theme.id}`: a computed id is
    // invisible to `npm run i18n-extract`, so these three never reached
    // en.json and read as dead entries in every other catalogue.
    const themes = (): Array<{id: ThemeName, displayName: string}> => [
        {id: lightThemeName, displayName: intl.formatMessage({id: 'Sidebar.light-theme', defaultMessage: 'Light theme'})},
        {id: darkThemeName, displayName: intl.formatMessage({id: 'Sidebar.dark-theme', defaultMessage: 'Dark theme'})},
        {id: systemThemeName, displayName: intl.formatMessage({id: 'Sidebar.system-theme', defaultMessage: 'System theme'})},
    ]

    return (
        <div class='SidebarSettingsMenu'>
            <MenuWrapper
                menu={
                    <Menu position='top'>
                        <Menu.SubMenu
                            id='import'
                            name={intl.formatMessage({id: 'Sidebar.import', defaultMessage: 'Import'})}
                            position='top'
                        >
                            <Menu.Text
                                id='import_archive'
                                name={intl.formatMessage({id: 'Sidebar.import-archive', defaultMessage: 'Import archive'})}
                                onClick={async () => {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ImportArchive)
                                    Archiver.importFullArchive()
                                }}
                            />
                            <For each={Constants.imports}>
                                {(i) => (
                                    <Menu.Text
                                        id={`${i.id}-import`}
                                        name={i.displayName}
                                        onClick={() => {
                                            TelemetryClient.trackEvent(TelemetryCategory, i.telemetryName)
                                            window.open(i.href)
                                        }}
                                    />
                                )}
                            </For>
                        </Menu.SubMenu>
                        <Menu.Text
                            id='export'
                            name={intl.formatMessage({id: 'Sidebar.export-archive', defaultMessage: 'Export archive'})}
                            onClick={async () => {
                                if (currentTeam()) {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ExportArchive)
                                    Archiver.exportFullArchive(currentTeam()!.id)
                                }
                            }}
                        />
                        <Menu.SubMenu
                            id='lang'
                            name={intl.formatMessage({id: 'Sidebar.set-language', defaultMessage: 'Set language'})}
                            position='top'
                        >
                            <For each={Constants.languages}>
                                {(language) => (
                                    <Menu.Text
                                        id={`${language.name}-lang`}
                                        name={language.displayName}
                                        onClick={async () => actions.language.storeLanguage(language.code)}
                                        rightIcon={intl.locale.toLowerCase() === language.code ? <CheckIcon/> : null}
                                    />
                                )}
                            </For>
                        </Menu.SubMenu>
                        <Menu.SubMenu
                            id='theme'
                            name={intl.formatMessage({id: 'Sidebar.set-theme', defaultMessage: 'Set theme'})}
                            position='top'
                        >
                            <For each={themes()}>
                                {(theme) => (
                                    <Menu.Text
                                        id={theme.id}
                                        name={theme.displayName}
                                        onClick={async () => updateTheme(theme.id)}
                                        rightIcon={themeName() === theme.id ? <CheckIcon/> : null}
                                    />
                                )}
                            </For>
                        </Menu.SubMenu>
                        {/* The card's own indicator is not a setting — it is
                            part of the card. This is only about interrupting. */}
                        <Menu.Switch
                            id='agent-notifications'
                            name={intl.formatMessage({id: 'Sidebar.agent-notifications', defaultMessage: 'Notify me when an agent is waiting'})}
                            isOn={agentNotificationsOn()}
                            onClick={async () => setAgentNotifications(!agentNotificationsOn())}
                            suppressItemClicked={true}
                        />
                        <Show when={isMachineSettingsAvailable()}>
                            <Menu.Text
                                id='machine'
                                name={intl.formatMessage({id: 'Sidebar.machine', defaultMessage: 'This machine…'})}
                                onClick={async () => setShowMachine(true)}
                            />
                        </Show>
                    </Menu>
                }
            >
                <div class='menu-entry'>
                    <FormattedMessage
                        id='Sidebar.settings'
                        defaultMessage='Settings'
                    />
                </div>
            </MenuWrapper>
            <Show when={showMachine()}>
                <MachineSettingsDialog onClose={() => setShowMachine(false)}/>
            </Show>
        </div>
    )
}

export default SidebarSettingsMenu
