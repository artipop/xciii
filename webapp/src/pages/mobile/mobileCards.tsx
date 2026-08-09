// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createResource, createSignal} from 'solid-js'
import type {Component} from 'solid-js'

import {useIntl} from '../../intl'

import {MobileBoard, listBoardCards} from './mobileBoards'

// The board's cards on a phone: one board at a time, newest first, each with
// the column it stands in.
//
// A list and not a kanban, which is the same decision the rest of this page is
// made of — a phone is not where columns are dragged. What it is for is finding
// out where something got to without walking to the desk.

type Props = {
    boards: MobileBoard[]
}

const MobileCards: Component<Props> = (props) => {
    const intl = useIntl()
    const [chosen, setChosen] = createSignal('')

    // The first board until somebody picks another, so the screen has content
    // the moment it opens.
    const current = () => chosen() || props.boards[0]?.id || ''
    const [cards] = createResource(current, listBoardCards)

    return (
        <section class='MobilePage__section'>
            <h2 class='MobilePage__heading'>
                {intl.formatMessage({id: 'Mobile.cards', defaultMessage: 'Cards'})}
            </h2>

            <Show
                when={props.boards.length > 0}
                fallback={
                    <p class='MobilePage__empty'>
                        {intl.formatMessage({id: 'Mobile.no-boards', defaultMessage: 'There are no boards yet.'})}
                    </p>
                }
            >
                {/* Chips rather than a select, because a select on a phone is a
                    modal of the operating system's and this is one tap. */}
                <div class='MobilePage__chips'>
                    <For each={props.boards}>
                        {(board) => (
                            <button
                                type='button'
                                class={`MobilePage__chip${current() === board.id ? ' MobilePage__chip--on' : ''}`}
                                onClick={() => setChosen(board.id)}
                            >
                                <span class='MobilePage__icon'>{board.icon}</span>
                                {board.title}
                            </button>
                        )}
                    </For>
                </div>

                <Show
                    when={(cards() || []).length > 0}
                    fallback={
                        <p class='MobilePage__empty'>
                            {intl.formatMessage({id: 'Mobile.no-cards', defaultMessage: 'This board has no cards.'})}
                        </p>
                    }
                >
                    <For each={cards()}>
                        {(card) => (
                            <article class='MobilePage__item'>
                                <Show when={card.column}>
                                    <span class='MobilePage__who'>{card.column}</span>
                                </Show>
                                <span class='MobilePage__card'>
                                    {card.icon ? `${card.icon} ` : ''}{card.title}
                                </span>
                            </article>
                        )}
                    </For>
                </Show>
            </Show>
        </section>
    )
}

export default MobileCards
