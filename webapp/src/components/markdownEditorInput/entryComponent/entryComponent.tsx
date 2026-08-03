// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import React, {ReactElement} from 'react'
import {FormattedMessage} from '../../../intl'

import GuestBadge from '../../../widgets/guestBadge'

import './entryComponent.scss'

const BotBadge = (window as any).Components?.BotBadge

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
const Entry = (props: Props): ReactElement => {
    const {mention, isSelected, onClick, onMouseEnter} = props

    return (
        <div
            class='EntryContainer'
            role='option'
            aria-selected={isSelected}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={onMouseEnter}
            onClick={onClick}
        >
            <div class='EntryComponent'>
                <div class='EntryComponent__left'>
                    <img
                        src={mention.avatar}
                        class='mentionSuggestionsEntryAvatar'
                        role='presentation'
                    />
                    <div class='mentionSuggestionsEntryText'>
                        {mention.name}
                        {BotBadge && mention.is_bot && <BotBadge/>}
                        <GuestBadge show={mention.is_guest}/>
                    </div>
                    <div class='mentionSuggestionsEntryText'>
                        {mention.displayName}
                    </div>
                </div>
                {!mention.isBoardMember &&
                    <div class='EntryComponent__hint mentionSuggestionsEntryText'>
                        <FormattedMessage
                            id='MentionSuggestion.is-not-board-member'
                            defaultMessage='(not board member)'
                        />
                    </div>}
            </div>
        </div>
    )
}

export default Entry
