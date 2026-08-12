import {Show} from 'solid-js'

import {FormattedMessage} from '../intl'

import './guestBadge.scss'

type Props = {
    show?: boolean
}

const GuestBadge = (props: Props) => {
    return (
        <Show when={props.show}>
            <div class='GuestBadge'>
                <div class='GuestBadge__box'>
                    <FormattedMessage
                        id='badge.guest'
                        defaultMessage='Guest'
                    />
                </div>
            </div>
        </Show>
    )
}

export default GuestBadge
