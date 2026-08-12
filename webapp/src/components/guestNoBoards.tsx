import {FormattedMessage} from '../intl'

import ErrorIllustration from '../svg/error-illustration'

import './guestNoBoards.scss'

const GuestNoBoards = () => {
    return (
        <div class='GuestNoBoards'>
            <div>
                <div class='title'>
                    <FormattedMessage
                        id='guest-no-board.title'
                        defaultMessage={'No boards yet'}
                    />
                </div>
                <div class='subtitle'>
                    <FormattedMessage
                        id='guest-no-board.subtitle'
                        defaultMessage={'You don\'t have access to any board in this team yet, please wait until somebody adds you to any board.'}
                    />
                </div>
                <ErrorIllustration/>
            </div>
        </div>
    )
}

export default GuestNoBoards
