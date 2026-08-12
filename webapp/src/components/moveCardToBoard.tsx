import {For, Show, createMemo, createSignal} from 'solid-js'
import type {Component} from 'solid-js'

import {FormattedMessage, useIntl} from '../intl'

import mutator from '../mutator'
import {Board, IPropertyOption, IPropertyTemplate} from '../blocks/board'
import {Card} from '../blocks/card'
import {getCard} from '../store/cards'
import {getMySortedBoards} from '../store/boards'
import {useAppSelector} from '../store/hooks'

import Label from '../widgets/label'

import Dialog from './dialog'
import './moveCardToBoard.scss'

// The dialog is opened from the card's menu, and a menu unmounts the moment it
// is clicked — so it cannot own a dialog of its own. The request is a signal
// instead, and the dialog is mounted once, beside the flash messages: the same
// arrangement, for the same reason.
const [movingCardId, setMovingCardId] = createSignal('')

export function openMoveCardToBoard(cardId: string): void {
    setMovingCardId(cardId)
}

// columnPropertyOf is the property whose options a person reads as the board's
// columns: its first select property, which is what a new board groups by. The
// board's own views would be a better answer, and they are the one the server
// gives — but the views of a board nobody has opened are not loaded here, and
// asking for them to fill a list would make opening this dialog a download.
function columnPropertyOf(board: Board): IPropertyTemplate|undefined {
    return board.cardProperties.find((property) => property.type === 'select')
}

const MoveCardToBoardDialog: Component<{cardId: string, onClose: () => void}> = (props) => {
    const intl = useIntl()
    const card = useAppSelector<Card|undefined>((state) => getCard(props.cardId)(state))
    const boards = useAppSelector<Board[]>(getMySortedBoards)
    const [target, setTarget] = createSignal<Board|undefined>(undefined)
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')

    const elsewhere = createMemo(() => boards().filter((board) => board.id !== card()?.boardId))
    const columnProperty = createMemo(() => {
        const board = target()
        return board ? columnPropertyOf(board) : undefined
    })

    const move = async (option?: IPropertyOption) => {
        const moved = card()
        const board = target()
        if (!moved || !board) {
            return
        }
        setBusy(true)
        setError('')
        try {
            await mutator.moveCardToBoard(moved, board.id, columnProperty()?.id, option?.id)
            props.onClose()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog
            size='small'
            class='MoveCardToBoard'
            onClose={props.onClose}
            title={
                <FormattedMessage
                    id='MoveCardToBoard.title'
                    defaultMessage='Move to a board'
                />
            }
            subtitle={card()?.title}
        >
            <div class='MoveCardToBoard__body'>
                <Show
                    when={target()}
                    fallback={
                        <>
                            <div class='MoveCardToBoard__step'>
                                <FormattedMessage
                                    id='MoveCardToBoard.pick-board'
                                    defaultMessage='Which board?'
                                />
                            </div>
                            <Show
                                when={elsewhere().length > 0}
                                fallback={
                                    <div class='MoveCardToBoard__empty'>
                                        <FormattedMessage
                                            id='MoveCardToBoard.no-other-boards'
                                            defaultMessage='There is no other board to move it to.'
                                        />
                                    </div>
                                }
                            >
                                <For each={elsewhere()}>
                                    {(board) => (
                                        <button
                                            class='MoveCardToBoard__option'
                                            onClick={() => setTarget(board)}
                                        >
                                            <span class='MoveCardToBoard__icon'>{board.icon}</span>
                                            {board.title || intl.formatMessage({id: 'MoveCardToBoard.untitled-board', defaultMessage: 'Untitled board'})}
                                        </button>
                                    )}
                                </For>
                            </Show>
                        </>
                    }
                >
                    <div class='MoveCardToBoard__step'>
                        <FormattedMessage
                            id='MoveCardToBoard.pick-column'
                            defaultMessage='Which column on «{board}»?'
                            values={{board: target()!.title}}
                        />
                    </div>
                    <For each={columnProperty()?.options || []}>
                        {(option) => (
                            <button
                                class='MoveCardToBoard__option MoveCardToBoard__option--column'
                                disabled={busy()}
                                onClick={() => move(option)}
                            >
                                <Label color={option.color}>{option.value}</Label>
                            </button>
                        )}
                    </For>
                    {/* Moving without choosing a column is a real answer: the
                        card's own column travels by name, and a board that has
                        one of the same name keeps the card where it was. */}
                    <button
                        class='MoveCardToBoard__option MoveCardToBoard__option--plain'
                        disabled={busy()}
                        onClick={() => move(undefined)}
                    >
                        <FormattedMessage
                            id='MoveCardToBoard.no-column'
                            defaultMessage='Just move it'
                        />
                    </button>
                </Show>
                <Show when={error()}>
                    <div class='MoveCardToBoard__error'>{error()}</div>
                </Show>
            </div>
        </Dialog>
    )
}

// MoveCardToBoard is the host: mounted once, showing the dialog when a card
// menu asks for it.
export const MoveCardToBoard: Component = () => (
    <Show when={movingCardId()}>
        <MoveCardToBoardDialog
            cardId={movingCardId()}
            onClose={() => setMovingCardId('')}
        />
    </Show>
)

export default MoveCardToBoard
