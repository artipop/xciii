// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useNavigate} from '@solidjs/router'

import {FormattedMessage} from '../../intl'

import Button from '../../widgets/buttons/button'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import {Utils} from '../../utils'
import {useRouteMatch} from '../../hooks/routerMatch'

import './shareBoardLoginButton.scss'

const ShareBoardLoginButton = () => {
    const match = useRouteMatch()
    const navigate = useNavigate()

    const loginPath = () => {
        let redirectQueryParam = 'r=' + encodeURIComponent(Utils.generatePath('/:boardId?/:viewId?/:cardId?', match().params))
        if (Utils.isFocalboardLegacy()) {
            redirectQueryParam = 'redirect_to=' + encodeURIComponent(Utils.generatePath('/boards/team/:teamId/:boardId?/:viewId?/:cardId?', match().params))
        }
        return '/login?' + redirectQueryParam
    }

    const onLoginClick = () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ShareBoardLogin)
        if (Utils.isFocalboardLegacy()) {
            location.assign(loginPath())
        } else {
            navigate(loginPath())
        }
    }

    return (
        <div class='ShareBoardLoginButton'>
            <Button
                title='Login'
                size='medium'
                emphasis='primary'
                onClick={() => onLoginClick()}
            >
                <FormattedMessage
                    id='CenterPanel.Login'
                    defaultMessage='Login'
                />
            </Button>
        </div>
    )
}

export default ShareBoardLoginButton
