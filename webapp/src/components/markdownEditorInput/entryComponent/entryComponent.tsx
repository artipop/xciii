import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import GuestBadge from '../../../widgets/guestBadge'

import './entryComponent.scss'

export type MentionUser = {
    user: {id: string} & Record<string, any>
    name: string
    avatar: string
    is_bot: boolean
    is_guest: boolean
    displayName: string
    isBoardMember: boolean
}

type Props = {
    mention: MentionUser
    isSelected: boolean
    onClick: () => void
    onMouseEnter: () => void
}

// A single row in the mentions typeahead popover. Markup mirrors the original
// draft-js-plugins Entry so the existing entryComponent.scss keeps applying.
// The host-injected BotBadge (window.Components, a React component) is gone:
// a React component cannot be rendered from Solid, and no host injects one
// into this build.
const Entry = (props: Props): JSX.Element => {
    return (
        <div
            class='EntryContainer'
            role='option'
            aria-selected={props.isSelected}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => props.onMouseEnter()}
            onClick={() => props.onClick()}
        >
            <div class='EntryComponent'>
                <div class='EntryComponent__left'>
                    <img
                        src={props.mention.avatar}
                        class='mentionSuggestionsEntryAvatar'
                        role='presentation'
                    />
                    <div class='mentionSuggestionsEntryText'>
                        {props.mention.name}
                        <GuestBadge show={props.mention.is_guest}/>
                    </div>
                    <div class='mentionSuggestionsEntryText'>
                        {props.mention.displayName}
                    </div>
                </div>
                <Show when={!props.mention.isBoardMember}>
                    <div class='EntryComponent__hint mentionSuggestionsEntryText'>
                        <FormattedMessage
                            id='MentionSuggestion.is-not-board-member'
                            defaultMessage='(not board member)'
                        />
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default Entry
