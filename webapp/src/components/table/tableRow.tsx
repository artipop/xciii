// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal, onMount} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Card} from '../../blocks/card'
import {Board, IPropertyTemplate} from '../../blocks/board'
import {Constants} from '../../constants'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Editable, {Focusable} from '../../widgets/editable'
import {useSortable} from '../../hooks/sortable'

import {Utils} from '../../utils'

import PropertyValueElement from '../propertyValueElement'
import MenuWrapper from '../../widgets/menuWrapper'
import IconButton from '../../widgets/buttons/iconButton'
import CompassIcon from '../../widgets/icons/compassIcon'
import OptionsIcon from '../../widgets/icons/options'
import Tooltip from '../../widgets/tooltip'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import CardActionsMenu from '../cardActionsMenu/cardActionsMenu'

import {useColumnResize} from './tableColumnResizeContext'

import './tableRow.scss'

type Props = {
    board: Board
    columnWidths: Record<string, number>
    isManualSort: boolean
    groupById?: string
    visiblePropertyIds: string[]
    collapsedOptionIds: string[]
    card: Card
    isSelected: boolean
    focusOnMount: boolean
    isLastCard: boolean
    showCard: (cardId?: string) => void
    readonly: boolean
    addCard: (groupByOptionId?: string) => Promise<void>
    onClick?: (e: MouseEvent, card: Card) => void
    onDrop: (srcCard: Card, dstCard: Card) => void
}

const TableRow = (props: Props) => {
    const intl = useIntl()

    let titleRef: Focusable | undefined
    const [title, setTitle] = createSignal(props.card.title || '')
    const isGrouped = () => Boolean(props.groupById)
    const [isDragging, isOver, cardRef] = useSortable('card', () => props.card, () => !props.readonly && (props.isManualSort || isGrouped()), (src, dst) => props.onDrop(src, dst))
    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)
    const columnResize = useColumnResize()

    onMount(() => {
        if (props.focusOnMount) {
            setTimeout(() => titleRef?.focus(), 10)
        }
    })

    const onClick = (e: MouseEvent) => {
        props.onClick && props.onClick(e, props.card)
    }

    const onSaveWithEnter = () => {
        if (props.isLastCard) {
            props.addCard(props.groupById ? props.card.fields.properties[props.groupById!] as string : '')
        }
    }

    const onSave = (saveType: 'onEnter' | 'onEsc' | 'onBlur') => {
        if (props.card.title !== title()) {
            mutator.changeBlockTitle(props.board.id, props.card.id, props.card.title, title())
            if (saveType === 'onEnter') {
                onSaveWithEnter()
            }
        }
    }

    const onTitleChange = (newTitle: string) => {
        setTitle(newTitle)
    }

    const visiblePropertyTemplates = () =>
        props.visiblePropertyIds.map((id) => props.board.cardProperties.find((t) => t.id === id)).filter((i) => i) as IPropertyTemplate[]

    const className = () => {
        const {card, board} = props
        let name = props.isSelected ? 'TableRow octo-table-row selected' : 'TableRow octo-table-row'
        if (isOver()) {
            name += ' dragover'
        }
        if (isGrouped()) {
            const groupID = props.groupById || ''
            let groupValue = card.fields.properties[groupID] as string || 'undefined'
            if (groupValue === 'undefined') {
                const template = board.cardProperties.find((p) => p.id === props.groupById)
                if (template && template.type === 'createdBy') {
                    groupValue = card.createdBy
                } else if (template && template.type === 'updatedBy') {
                    groupValue = card.modifiedBy
                }
            } else if (Array.isArray(groupValue)) {
                groupValue = groupValue[0]
            }
            if (props.collapsedOptionIds.indexOf(groupValue) > -1) {
                name += ' hidden'
            }
        }
        if (props.readonly) {
            name += ' readonly'
        }
        return name
    }

    const handleDeleteCard = async () => {
        const card = props.card
        if (!card) {
            Utils.assertFailure()
            return
        }
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DeleteCard, {board: props.board.id, card: card.id})
        await mutator.deleteBlock(card, 'delete card')
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
        if (props.card?.title === '' && props.card?.fields.contentOrder.length === 0) {
            handleDeleteCard()
            return
        }
        setShowConfirmationDialogBox(true)
    }

    return (
        <div
            class={className()}
            onClick={onClick}
            ref={cardRef}
            style={{opacity: isDragging() ? 0.5 : 1}}
        >

            <div class='action-cell octo-table-cell-btn'>
                <Show when={!props.readonly}>
                    <IconButton icon={<CompassIcon icon='drag-vertical'/>}/>
                </Show>
            </div>

            {/* Name / title */}
            <div
                class='octo-table-cell title-cell'
                id='mainBoardHeader'
                style={{width: `${columnResize.width(Constants.titleColumnId)}px`}}
                ref={(ref) => columnResize.updateRef(props.card.id, Constants.titleColumnId, ref)}
            >
                <div class='octo-icontitle'>
                    <div class='octo-icon'>{props.card.fields.icon}</div>
                    <Editable
                        ref={(f) => (titleRef = f)}
                        value={title()}
                        placeholderText='Untitled'
                        onChange={onTitleChange}
                        onSave={onSave}
                        onCancel={() => setTitle(props.card.title || '')}
                        readonly={props.readonly}
                        spellCheck={true}
                    />
                </div>

                <Show when={!props.readonly}>
                    <MenuWrapper
                        className='optionsMenu ml-2 mr-2'
                        stopPropagationOnToggle={true}
                        menu={
                            <CardActionsMenu
                                cardId={props.card.id}
                                boardId={props.card.boardId}
                                onClickDelete={handleDeleteButtonOnClick}
                                onClickDuplicate={() => {
                                    mutator.duplicateCard(
                                        props.card.id,
                                        props.board.id,
                                        false,
                                        intl.formatMessage({id: 'TableRow.DuplicateCard', defaultMessage: 'duplicate card'}),
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
                        <Tooltip
                            title={intl.formatMessage({id: 'TableRow.MoreOption', defaultMessage: 'More actions'})}
                        >
                            <IconButton
                                title='MenuBtn'
                                icon={<OptionsIcon/>}
                            />
                        </Tooltip>
                    </MenuWrapper>
                </Show>

                <div class='open-button'>
                    <Button onClick={() => props.showCard(props.card.id || '')}>
                        <FormattedMessage
                            id='TableRow.open'
                            defaultMessage='Open'
                        />
                    </Button>
                </div>
            </div>

            {/* Columns, one per property */}
            <For each={visiblePropertyTemplates()}>
                {(template) => (
                    <div
                        class='octo-table-cell'
                        style={{width: `${columnResize.width(template.id)}px`}}
                        ref={(ref) => columnResize.updateRef(props.card.id, template.id, ref)}
                    >
                        <PropertyValueElement
                            readOnly={props.readonly}
                            card={props.card}
                            board={props.board}
                            propertyTemplate={template}
                            showEmptyPlaceholder={false}
                        />
                    </div>
                )}
            </For>

            <Show when={showConfirmationDialogBox()}>
                <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
            </Show>
        </div>
    )
}

export default TableRow
