import {Show, createSignal} from 'solid-js'
import {useNavigate} from '@solidjs/router'

import {useIntl} from '../../intl'

import {Constants} from '../../constants'
import octoClient from '../../octoClient'
import {IUser} from '../../user'
import AppLogoIcon from '../../widgets/icons/appLogo'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import {getMe} from '../../store/users'
import {getTeamMode} from '../../store/clientConfig'
import {useAppSelector, useAppStore} from '../../store/hooks'

import ModalWrapper from '../modalWrapper'

import {IAppWindow} from '../../types'

import RegistrationLink from './registrationLink'

import './sidebarUserMenu.scss'

declare let window: IAppWindow

const SidebarUserMenu = () => {
    const {actions} = useAppStore()
    const navigate = useNavigate()
    const [showRegistrationLinkDialog, setShowRegistrationLinkDialog] = createSignal(false)
    const user = useAppSelector<IUser|null>(getMe)
    const teamMode = useAppSelector<boolean>(getTeamMode)
    const intl = useIntl()

    return (
        <div class='SidebarUserMenu'>
            <ModalWrapper>
                <MenuWrapper
                    menu={
                        <Menu>
                            {/* An account's own menu — the name, logging out,
                                the password, the invite — is drawn where there
                                are accounts. It used to ask the id, which
                                stopped being the question once the person at
                                the machine registered under it
                                (docs/teamwork.md). */}
                            <Show when={user() && teamMode()}>
                                <Menu.Label><b>{user()!.username}</b></Menu.Label>
                                <Menu.Text
                                    id='logout'
                                    name={intl.formatMessage({id: 'Sidebar.logout', defaultMessage: 'Log out'})}
                                    onClick={async () => {
                                        await octoClient.logout()
                                        actions.users.setMe(null)
                                        navigate('/login')
                                    }}
                                />
                                <Menu.Text
                                    id='changePassword'
                                    name={intl.formatMessage({id: 'Sidebar.changePassword', defaultMessage: 'Change password'})}
                                    onClick={async () => {
                                        navigate('/change_password')
                                    }}
                                />
                                <Menu.Text
                                    id='invite'
                                    name={intl.formatMessage({id: 'Sidebar.invite-users', defaultMessage: 'Invite users'})}
                                    onClick={async () => {
                                        setShowRegistrationLinkDialog(true)
                                    }}
                                />

                                <Menu.Separator/>
                            </Show>

                            <Menu.Text
                                id='about'
                                name={intl.formatMessage({id: 'Sidebar.about', defaultMessage: 'About XCIII'})}
                                onClick={async () => {
                                    window.open(Constants.homeUrl, '_blank')

                                    // TODO: Review if this is needed in the future, this is to fix the problem with linux webview links
                                    if (window.openInNewBrowser) {
                                        window.openInNewBrowser(Constants.homeUrl)
                                    }
                                }}
                            />
                        </Menu>
                    }
                >
                    <div class='logo'>
                        <div class='logo-title'>
                            <AppLogoIcon/>
                            <span>{'XCIII'}</span>
                        </div>
                    </div>
                </MenuWrapper>

                <Show when={showRegistrationLinkDialog()}>
                    <RegistrationLink
                        onClose={() => {
                            setShowRegistrationLinkDialog(false)
                        }}
                    />
                </Show>
            </ModalWrapper>
        </div>
    )
}

export default SidebarUserMenu
