import {useNavigate} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'
import {Utils} from '../../utils'
import {useRouteMatch} from '../../hooks/routerMatch'

import './shareBoardLoginButton.scss'

const ShareBoardLoginButton = () => {
    const intl = useIntl()
    const match = useRouteMatch()
    const navigate = useNavigate()

    const loginPath = () => {
        const redirectQueryParam = 'r=' + encodeURIComponent(Utils.generatePath('/:boardId?/:viewId?/:cardId?', match().params))
        return '/login?' + redirectQueryParam
    }

    const onLoginClick = () => {
        navigate(loginPath())
    }

    return (
        <div class='ShareBoardLoginButton'>
            <Button
                title={intl.formatMessage({id: 'CenterPanel.Login', defaultMessage: 'Login'})}
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
