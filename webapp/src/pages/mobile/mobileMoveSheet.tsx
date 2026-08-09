// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'
import type {Component} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'
import Label from '../../widgets/label'

import {MobileBoard, MobileCard, moveCardToBoard} from './mobileBoards'

// Where a card from the inbox goes: a board, then a column of it. A sheet from
// the bottom rather than a dialog, because the two lists are long and a thumb
// reaches the bottom of a phone and not the middle of it.

type Props = {
    card: MobileCard
    boards: MobileBoard[]
    onDone: () => void
    onClose: () => void
}

const MobileMoveSheet: Component<Props> = (props) => {
    const intl = useIntl()
    const [target, setTarget] = createSignal<MobileBoard|undefined>(undefined)
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    const elsewhere = () => props.boards.filter((board) => board.id !== props.card.boardId)

    const move = async (column: string) => {
        const board = target()
        if (!board) {
            return
        }
        setBusy(true)
        setError('')
        try {
            await moveCardToBoard(props.card.id, board.id, column)
            props.onDone()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class='MobileSheet'>
            <button
                type='button'
                class='MobileSheet__backdrop'
                aria-label={intl.formatMessage({id: 'Mobile.close', defaultMessage: 'Close'})}
                onClick={() => props.onClose()}
            />
            <div class='MobileSheet__panel'>
                <p class='MobileSheet__card'>{props.card.title}</p>
                <Show
                    when={target()}
                    fallback={
                        <>
                            <h3 class='MobileSheet__heading'>
                                <FormattedMessage
                                    id='Mobile.pick-board'
                                    defaultMessage='Which board?'
                                />
                            </h3>
                            <Show
                                when={elsewhere().length > 0}
                                fallback={
                                    <p class='MobilePage__empty'>
                                        <FormattedMessage
                                            id='Mobile.no-other-boards'
                                            defaultMessage='There is no other board to move it to.'
                                        />
                                    </p>
                                }
                            >
                                <For each={elsewhere()}>
                                    {(board) => (
                                        <button
                                            type='button'
                                            class='MobileSheet__option'
                                            onClick={() => setTarget(board)}
                                        >
                                            <span class='MobileSheet__icon'>{board.icon}</span>
                                            {board.title}
                                        </button>
                                    )}
                                </For>
                            </Show>
                        </>
                    }
                >
                    <h3 class='MobileSheet__heading'>
                        <FormattedMessage
                            id='Mobile.pick-column'
                            defaultMessage='Which column on «{board}»?'
                            values={{board: target()!.title}}
                        />
                    </h3>
                    {/* Drawn as the board draws a column — the same chip in
                        the same colour — so a list of columns reads as one. */}
                    <For each={target()!.columns || []}>
                        {(column) => (
                            <button
                                type='button'
                                class='MobileSheet__option MobileSheet__option--column'
                                disabled={busy()}
                                onClick={() => move(column.value)}
                            >
                                <Label color={column.color}>{column.value}</Label>
                            </button>
                        )}
                    </For>
                    {/* Moving without naming a column is a real answer: the
                        card's own column travels by name, and a board with one
                        of the same name keeps the card where it stood. */}
                    <button
                        type='button'
                        class='MobileSheet__option MobileSheet__option--plain'
                        disabled={busy()}
                        onClick={() => move('')}
                    >
                        <FormattedMessage
                            id='Mobile.no-column'
                            defaultMessage='Just move it'
                        />
                    </button>
                </Show>
                <Show when={error()}>
                    <p class='MobileSheet__error'>{error()}</p>
                </Show>
            </div>
        </div>
    )
}

export default MobileMoveSheet
