import {For, Show} from 'solid-js'

import {useNavigate} from '@solidjs/router'

import {useIntl} from '../../intl'

import {Archiver} from '../../archiver'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {getMe} from '../../store/users'
import {getCurrentTeam, Team} from '../../store/teams'
import {IUser, UserConfigPatch} from '../../user'
import octoClient from '../../octoClient'
import CheckIcon from '../../widgets/icons/check'
import SettingsIcon from '../../widgets/icons/settings'

import {Constants} from '../../constants'
import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import './globalHeaderSettingsMenu.scss'

const GlobalHeaderSettingsMenu = () => {
    const intl = useIntl()
    const me = useAppSelector<IUser|null>(getMe)
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)
    const {actions} = useAppStore()
    const navigate = useNavigate()

    return (
        <div class='GlobalHeaderSettingsMenu'>
            <MenuWrapper
                menu={
                    <Menu position='left'>
                        <Menu.SubMenu
                            id='import'
                            name={intl.formatMessage({id: 'Sidebar.import', defaultMessage: 'Import'})}
                            position='left-bottom'
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
                        <Menu.SubMenu
                            id='lang'
                            name={intl.formatMessage({id: 'Sidebar.set-language', defaultMessage: 'Set language'})}
                            position='left-bottom'
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
                        <Show when={me()?.is_guest !== true}>
                            <Menu.Text
                                id='product-tour'
                                class='product-tour'
                                name={intl.formatMessage({id: 'Sidebar.product-tour', defaultMessage: 'Product tour'})}
                                onClick={async () => {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.StartTour)

                                    const user = me()
                                    if (!user) {
                                        return
                                    }
                                    const team = currentTeam()
                                    if (!team) {
                                        return
                                    }

                                    const patch: UserConfigPatch = {
                                        updatedFields: {
                                            onboardingTourStarted: '1',
                                            onboardingTourStep: '0',
                                            tourCategory: 'onboarding',
                                        },
                                    }

                                    const patchedProps = await octoClient.patchUserConfig(user.id, patch)
                                    if (patchedProps) {
                                        actions.users.patchProps(patchedProps)
                                    }

                                    const onboardingData = await octoClient.prepareOnboarding(team.id)

                                    const newPath = `/team/${onboardingData?.teamID}/${onboardingData?.boardID}`

                                    navigate(newPath)
                                }}
                            />
                        </Show>
                    </Menu>
                }
            >
                <div class='GlobalHeaderComponent__button menu-entry'>
                    <SettingsIcon/>
                </div>
            </MenuWrapper>
        </div>
    )
}

export default GlobalHeaderSettingsMenu
