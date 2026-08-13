import {Show, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import SettingsIcon from '../../widgets/icons/settings'
import RootPortal from '../rootPortal'
import AppSettingsDialog from '../settings/appSettingsDialog'
import {updateWaiting, useUpdateState} from '../settings/updates'

import './sidebarSettingsButton.scss'

// The foot of the sidebar used to be a menu with a submenu of a submenu in it:
// import, export, language, theme, notifications and "this machine…", which is
// where a person went looking for any of the six and found the other five.
// It opens the settings dialog instead — one place, sections down the side.
// The theme and the language spent a while in the corner of the board on the
// grounds that they are changed while looking at it; they are back here with
// everything else, and the corner they were in is gone.

const SidebarSettingsButton = () => {
    const intl = useIntl()
    const [showSettings, setShowSettings] = createSignal(false)

    // A new version is only ever shown inside this dialog, and nobody opens a
    // settings dialog to find out whether there is one. The dot is the whole of
    // how it gets mentioned — no notification, because an update is not
    // something to interrupt anybody over.
    const updates = useUpdateState()

    return (
        <div class='SidebarSettingsButton'>
            <button
                type='button'
                class='SidebarSettingsButton__entry'
                aria-label={intl.formatMessage({id: 'Sidebar.settings', defaultMessage: 'Settings'})}
                onClick={() => setShowSettings(true)}
            >
                <SettingsIcon/>
                <FormattedMessage
                    id='Sidebar.settings'
                    defaultMessage='Settings'
                />
                <Show when={updateWaiting(updates())}>
                    <span
                        class='SidebarSettingsButton__dot'
                        title={intl.formatMessage({id: 'Updates.waiting', defaultMessage: 'A new version is available'})}
                    />
                </Show>
            </button>
            {/* Out of the sidebar, because the sidebar paints its own text
                colour and everything under it inherits: a dialog opened from
                here used to draw every heading in the sidebar's light ink,
                which is invisible on the light theme's paper. */}
            <Show when={showSettings()}>
                <RootPortal>
                    <AppSettingsDialog onClose={() => setShowSettings(false)}/>
                </RootPortal>
            </Show>
        </div>
    )
}

export default SidebarSettingsButton
