// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'

import {useIntl, FormattedMessage} from '../../intl'

import IconButton from '../../widgets/buttons/iconButton'
import Button from '../../widgets/buttons/button'

import CloseIcon from '../../widgets/icons/close'

import {useAppActions, useAppSelector} from '../../store/hooks'
import octoClient from '../../octoClient'
import {IUser, UserConfigPatch} from '../../user'
import {getMe, getVersionMessageCanceled, versionProperty} from '../../store/users'

import CompassIcon from '../../widgets/icons/compassIcon'
import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import './versionMessage.scss'
const helpURL = 'https://mattermost.com/pl/whats-new-boards/'

const VersionMessage = () => {
    const intl = useIntl()
    const actions = useAppActions()
    const me = useAppSelector<IUser|null>(getMe)
    const versionMessageCanceled = useAppSelector(getVersionMessageCanceled)

    const closeDialogText = intl.formatMessage({
        id: 'Dialog.closeDialog',
        defaultMessage: 'Close dialog',
    })

    const onClose = async () => {
        const user = me()
        if (user) {
            const patch: UserConfigPatch = {
                updatedFields: {
                    [versionProperty]: 'true',
                },
            }
            const patchedProps = await octoClient.patchUserConfig(user.id, patch)
            if (patchedProps) {
                actions.users.patchProps(patchedProps)
            }
        }
    }

    return (
        <Show when={me() && me()!.id !== 'single-user' && !versionMessageCanceled()}>
            <div class='VersionMessage'>
                <div class='banner'>
                    <CompassIcon
                        icon='information-outline'
                        class='CompassIcon'
                    />
                    <FormattedMessage
                        id='VersionMessage.help'
                        defaultMessage="Check out what's new in this version."
                    />

                    <Button
                        title={intl.formatMessage({id: 'VersionMessage.learn-more', defaultMessage: 'Learn more'})}
                        size='xsmall'
                        emphasis='primary'
                        onClick={() => {
                            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.VersionMoreInfo)
                            window.open(helpURL)
                        }}
                    >
                        <FormattedMessage
                            id='VersionMessage.learn-more'
                            defaultMessage='Learn more'
                        />
                    </Button>

                </div>

                <IconButton
                    class='margin-right'
                    onClick={onClose}
                    icon={<CloseIcon/>}
                    title={closeDialogText}
                    size='small'
                />
            </div>
        </Show>
    )
}
export default VersionMessage
