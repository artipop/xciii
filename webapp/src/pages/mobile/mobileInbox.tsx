// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'
import type {Component} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {BindingBoard, BindingCard} from '../../bindings/boards'
import MobileMoveSheet from './mobileMoveSheet'

// What arrived and nobody has looked at yet: the cards a source left in the
// inbox of every board that has one. This is the screen the sources subsystem
// is for — a letter turns into a card here, and a person decides which board
// it belongs on.
//
// The list itself is the page's, not this component's, because the number on
// the tab has to be right before anybody opens the tab. What is here is the
// reading of it and the one thing you can do to it.
//
// A card is shown by its title and where it came from. Its text is not read:
// that would be a query per card, and a list costing a query per row is one
// that stops working on the board where it matters most.

type Props = {
    cards: BindingCard[]
    boards: BindingBoard[]
    onMoved: () => void
}

const MobileInbox: Component<Props> = (props) => {
    const intl = useIntl()
    const [moving, setMoving] = createSignal<BindingCard|undefined>(undefined)

    const moved = () => {
        setMoving(undefined)
        props.onMoved()
    }

    return (
        <section class='MobilePage__section'>
            <h2 class='MobilePage__heading'>
                {intl.formatMessage({id: 'Mobile.inbox', defaultMessage: 'Inbox'})}
            </h2>
            <Show
                when={props.cards.length > 0}
                fallback={
                    <p class='MobilePage__empty'>
                        {intl.formatMessage({id: 'Mobile.inbox-empty', defaultMessage: 'Nothing has arrived.'})}
                    </p>
                }
            >
                <For each={props.cards}>
                    {(card) => (
                        <article class='MobilePage__item'>
                            <span class='MobilePage__who'>
                                {card.author ||
                                    intl.formatMessage({id: 'Mobile.inbox-source', defaultMessage: 'Arrived'})}
                            </span>
                            <span class='MobilePage__card'>
                                {card.icon ? `${card.icon} ` : ''}{card.title}
                            </span>
                            <Show when={card.properties?.['Ссылка']}>
                                <a
                                    class='MobilePage__link'
                                    href={card.properties!['Ссылка']}
                                    target='_blank'
                                    rel='noreferrer'
                                >
                                    {card.properties!['Ссылка']}
                                </a>
                            </Show>
                            <button
                                type='button'
                                class='MobilePage__action'
                                onClick={() => setMoving(card)}
                            >
                                <FormattedMessage
                                    id='Mobile.move'
                                    defaultMessage='Move to a board…'
                                />
                            </button>
                        </article>
                    )}
                </For>
            </Show>

            <Show when={moving()}>
                <MobileMoveSheet
                    card={moving()!}
                    boards={props.boards}
                    onDone={moved}
                    onClose={() => setMoving(undefined)}
                />
            </Show>
        </section>
    )
}

export default MobileInbox
