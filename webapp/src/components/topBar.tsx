import type {JSX} from 'solid-js'

import './topBar.scss'
import {FormattedMessage} from '../intl'

import HelpIcon from '../widgets/icons/help'
import {Constants} from '../constants'

import ThemeMenu from './themeMenu'
import LanguageMenu from './languageMenu'

// The corner where the app speaks for itself rather than about a board: how it
// looks, what language it speaks, where to complain and where the manual is.
// The theme and the language moved here out of the sidebar's settings menu —
// they are the two things a person changes by looking at the screen, and
// everything left in that menu is decided once and lives in a dialog now.
type Props = {

    // The screen that stands in for a board when there is none is one full-page
    // overlay, and it would bury the corner. Nothing else on the page needs
    // this, so it is asked for rather than assumed.
    overPage?: boolean
}

const TopBar = (props: Props): JSX.Element => {
    return (
        <div
            class={`TopBar${props.overPage ? ' TopBar--overPage' : ''}`}
        >
            <ThemeMenu/>
            <LanguageMenu/>
            <span class='TopBar__divider'/>
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
            <a
                href={Constants.homeUrl}
                target='_blank'
                rel='noreferrer'
            >
                <HelpIcon/>
            </a>
        </div>
    )
}

export default TopBar
