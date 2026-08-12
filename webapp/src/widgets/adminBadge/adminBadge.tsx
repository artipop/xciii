import {Show} from 'solid-js'

import {useIntl} from '../../intl'

import './adminBadge.scss'

type Props = {
    permissions?: string[]
}

const AdminBadge = (props: Props) => {
    const intl = useIntl()

    // Empty when this user holds neither role, which is also what hides the
    // badge: a permission arriving over the WebSocket has to reach the DOM.
    const text = () => {
        const permissions = props.permissions
        if (!permissions) {
            return ''
        }
        if (permissions.find((s) => s === 'manage_system')) {
            return intl.formatMessage({id: 'AdminBadge.SystemAdmin', defaultMessage: 'Admin'})
        }
        if (permissions.find((s) => s === 'manage_team')) {
            return intl.formatMessage({id: 'AdminBadge.TeamAdmin', defaultMessage: 'Team Admin'})
        }
        return ''
    }

    return (
        <Show when={text()}>
            <div class='AdminBadge'>
                <div class='AdminBadge__box'>
                    {text()}
                </div>
            </div>
        </Show>
    )
}

export default AdminBadge
