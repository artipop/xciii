import {For, Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {useListSortable} from '../../hooks/sortable'
import mutator from '../../mutator'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import {Utils} from '../../utils'
import MenuWrapper from '../../widgets/menuWrapper'
import Tooltip from '../../widgets/tooltip'
import PropertyValueElement from '../propertyValueElement'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'
import './kanbanCard.scss'
import CardBadges from '../cardBadges'
import CardActionsMenu from '../cardActionsMenu/cardActionsMenu'
import CardActionsMenuIcon from '../cardActionsMenu/cardActionsMenuIcon'
import {attentionHeading, useCardAttention} from '../acp/attention'
import {isCardTerminalAvailable, openCardTerminalWindow, useCardTerminal} from '../acp/liveTerminals'

export const OnboardingCardClassName = 'onboardingCard'

type Props = {
    card: Card
    board: Board
    visiblePropertyTemplates: IPropertyTemplate[]
    isSelected: boolean
    visibleBadges: boolean
    onClick?: (e: MouseEvent, card: Card) => void
    readonly: boolean
    onDrop: (srcCard: Card, dstCard: Card) => void
    showCard: (cardId?: string) => void
    isManualSort: boolean

    // Where the card sits, which is what a drag changes: dnd-kit needs the list
    // and the place in it to tell a move between columns from a reorder within
    // one, rather than only that something was released over something else.
    index: number
    groupId: string

    // dragDisabled is for a board whose columns are not places a card can be
    // put — «Входящие», grouped by who brought the card. It is not the same as
    // readonly: the card still opens, and its menu still works.
    dragDisabled?: boolean
}

const KanbanCard = (props: Props) => {
    const intl = useIntl()
    const [isDragging, isOver, cardRef] = useListSortable(
        'card',
        () => props.card,
        () => !props.readonly && !props.dragDisabled,
        (src, dst) => props.onDrop(src, dst),
        () => ({id: props.card.id, index: props.index, group: props.groupId}),
    )
    const visiblePropertyTemplates = () => props.visiblePropertyTemplates || []

    // An agent that has stopped to ask something is the one thing about a card
    // that a person has to notice without opening it — the terminal it asked in
    // is a window nobody is looking at.
    const attention = useCardAttention(() => props.card.id)
    const attentionTitle = () => attentionHeading(intl, attention()!)

    // And a terminal already running on the card is the other thing worth
    // seeing from here — it is where the work is happening, and where a
    // question was asked. The dot is both: what it means is the colour, what it
    // does is open the terminal, so getting to the CLI from the board is one
    // click rather than a card, a toolbar and a panel.
    const liveTerminal = useCardTerminal(() => props.card.id)
    const showsAgent = () => Boolean(attention() || liveTerminal())
    const canOpenTerminal = () => !props.readonly && isCardTerminalAvailable()
    const agentTitle = () => (attention() ? attentionTitle() : intl.formatMessage({id: 'KanbanCard.open-terminal', defaultMessage: 'Open the terminal'}))

    const openTerminal = (e: MouseEvent) => {
        // The card is a click target of its own, and opening the dialog behind
        // the terminal window is not what pressing this asked for.
        e.stopPropagation()
        openCardTerminalWindow(props.card.id)
    }
    const classes = () => {
        let name = props.isSelected ? 'KanbanCard selected' : 'KanbanCard'
        if (props.isManualSort && isOver()) {
            name += ' dragover'
        }
        return name
    }

    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)
    const handleDeleteCard = () => {
        const card = props.card
        if (!card) {
            Utils.assertFailure()
            return
        }
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DeleteCard, {board: props.board.id, card: card.id})
        mutator.deleteBlock(card, 'delete card')
    }

    const confirmDialogProps: ConfirmationDialogBoxProps = {
        heading: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-heading', defaultMessage: 'Confirm card delete!'}),
        confirmButtonText: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-button-text', defaultMessage: 'Delete'}),
        onConfirm: handleDeleteCard,
        onClose: () => {
            setShowConfirmationDialogBox(false)
        },
    }

    const handleDeleteButtonOnClick = () => {
        // user trying to delete a card with blank name
        // but content present cannot be deleted without
        // confirmation dialog
        if (props.card?.title === '' && props.card?.fields?.contentOrder?.length === 0) {
            handleDeleteCard()
            return
        }
        setShowConfirmationDialogBox(true)
    }

    const handleOnClick = (e: MouseEvent) => {
        if (props.onClick) {
            props.onClick(e, props.card)
        }
    }

    return (
        <>
            <div
                ref={props.readonly || props.dragDisabled ? undefined : cardRef}
                class={classes()}
                style={{opacity: isDragging() ? 0.5 : 1}}
                onClick={handleOnClick}
            >
                <Show when={!props.readonly}>
                    <MenuWrapper
                        class={'optionsMenu'}
                        stopPropagationOnToggle={true}
                        menu={
                            <CardActionsMenu
                                cardId={props.card!.id}
                                boardId={props.card!.boardId}
                                onClickDelete={handleDeleteButtonOnClick}
                                onClickDuplicate={() => {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DuplicateCard, {board: props.board.id, card: props.card.id})
                                    mutator.duplicateCard(
                                        props.card.id,
                                        props.board.id,
                                        false,
                                        'duplicate card',
                                        false,
                                        {},
                                        async (newCardId) => {
                                            props.showCard(newCardId)
                                        },
                                        async () => {
                                            props.showCard(undefined)
                                        },
                                    )
                                }}
                            />
                        }
                    >
                        <CardActionsMenuIcon/>
                    </MenuWrapper>
                </Show>

                <div class='octo-icontitle'>
                    <Show when={showsAgent()}>
                        <Show
                            when={canOpenTerminal()}
                            fallback={
                                <span
                                    class='KanbanCard__attention'
                                    classList={{'KanbanCard__attention--live': !attention()}}
                                    role='status'
                                    title={agentTitle()}
                                    aria-label={agentTitle()}
                                />
                            }
                        >
                            <button
                                type='button'
                                class='KanbanCard__attention'
                                classList={{'KanbanCard__attention--live': !attention()}}
                                title={agentTitle()}
                                aria-label={agentTitle()}
                                onClick={openTerminal}
                            />
                        </Show>
                    </Show>
                    <Show when={props.card.fields.icon}>
                        <div class='octo-icon'>{props.card.fields.icon}</div>
                    </Show>
                    <div
                        class='octo-titletext'
                    >
                        {props.card.title || intl.formatMessage({id: 'KanbanCard.untitled', defaultMessage: 'Untitled'})}
                    </div>
                </div>
                <For each={visiblePropertyTemplates()}>
                    {(template) => (
                        <Tooltip
                            title={template.name}
                        >
                            <PropertyValueElement
                                board={props.board}
                                readOnly={true}
                                card={props.card}
                                propertyTemplate={template}
                                showEmptyPlaceholder={false}
                            />
                        </Tooltip>
                    )}
                </For>
                <Show when={props.visibleBadges}>
                    <CardBadges card={props.card}/>
                </Show>
            </div>

            <Show when={showConfirmationDialogBox()}>
                <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
            </Show>
        </>
    )
}

export default KanbanCard
