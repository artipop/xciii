import type {JSX} from 'solid-js'

import './topBar.scss'
import {FormattedMessage} from '../intl'

import {Constants} from '../constants'

// One link, and it is the only thing in this corner that is neither a setting
// nor about a board: somewhere to say that something is broken, from wherever
// it broke. How the app looks, what language it speaks and where the manual is
// were here too, as two icon menus and a question mark; they are answered once
// and they are answered in the settings dialog now (`settings/appPanel.tsx`).

const TopBar = (): JSX.Element => {
    return (
        <div class='TopBar'>
            <a
                class='link'
                href={Constants.issuesUrl}
                target='_blank'
                rel='noreferrer'
            >
                <FormattedMessage
                    id='TopBar.give-feedback'
                    defaultMessage='Give feedback'
                />
            </a>
        </div>
    )
}

export default TopBar
