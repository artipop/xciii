// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import React, {useState} from 'react'
import {useIntl, FormattedMessage} from '../../intl'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {ContentBlock} from '../../blocks/contentBlock'
import {useSortable} from '../../hooks/sortable'
import mutator from '../../mutator'
import {getCardContents} from '../../store/contents'
import {useAppSelector} from '../../store/hooks'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import MenuWrapper from '../../widgets/menuWrapper'
import Tooltip from '../../widgets/tooltip'
import {CardDetailProvider} from '../cardDetail/cardDetailContext'
import ContentElement from '../content/contentElement'
import ImageElement from '../content/imageElement'
import PropertyValueElement from '../propertyValueElement'
import './galleryCard.scss'
import CardBadges from '../cardBadges'
import CardActionsMenu from '../cardActionsMenu/cardActionsMenu'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'
import CardActionsMenuIcon from '../cardActionsMenu/cardActionsMenuIcon'

type Props = {
    board: Board
    card: Card
    onClick: (e: MouseEvent, card: Card) => void
    visiblePropertyTemplates: IPropertyTemplate[]
    visibleTitle: boolean
    isSelected: boolean
    visibleBadges: boolean
    readonly: boolean
    isManualSort: boolean
    onDrop: (srcCard: Card, dstCard: Card) => void
}

const GalleryCard = (props: Props) => {
    const intl = useIntl()
    const {card, board} = props
    const [isDragging, isOver, cardRef] = useSortable('card', card, props.isManualSort && !props.readonly, props.onDrop)
    const contents = useAppSelector(getCardContents(card.id))
    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = useState<boolean>(false)

    const visiblePropertyTemplates = props.visiblePropertyTemplates || []

    const handleDeleteCard = () => {
        mutator.deleteBlock(card, 'delete card')
    }

    const confirmDialogProps: ConfirmationDialogBoxProps = (() => {
        return {
            heading: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-heading', defaultMessage: 'Confirm card delete!'}),
            confirmButtonText: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-button-text', defaultMessage: 'Delete'}),
            onConfirm: handleDeleteCard,
            onClose: () => {
                setShowConfirmationDialogBox(false)
            },
        }
    })()

    const image: ContentBlock|undefined = (() => {
        for (let i = 0; i < contents.length; ++i) {
            if (Array.isArray(contents[i])) {
                return (contents[i] as ContentBlock[]).find((c) => c.type === 'image')
            } else if ((contents[i] as ContentBlock).type === 'image') {
                return contents[i] as ContentBlock
            }
        }
        return undefined
    })()

    let className = props.isSelected ? 'GalleryCard selected' : 'GalleryCard'
    if (isOver) {
        className += ' dragover'
    }

    return (
        <>
            <div
                class={className}
                onClick={(e: MouseEvent) => props.onClick(e, card)}
                style={{opacity: isDragging ? 0.5 : 1}}
                ref={cardRef}
            >
                {!props.readonly &&
                    <MenuWrapper
                        className='optionsMenu'
                        stopPropagationOnToggle={true}
                    >
                        <CardActionsMenuIcon/>
                        <CardActionsMenu
                            cardId={card!.id}
                            boardId={card!.boardId}
                            onClickDelete={() => setShowConfirmationDialogBox(true)}
                            onClickDuplicate={() => {
                                TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DuplicateCard, {board: board.id, card: card.id})
                                mutator.duplicateCard(card.id, board.id)
                            }}
                        />
                    </MenuWrapper>
                }

                {image &&
                    <div class='gallery-image'>
                        <ImageElement block={image}/>
                    </div>}
                {!image &&
                    <CardDetailProvider card={card}>
                        <div class='gallery-item'>
                            {contents.map((block) => {
                                if (Array.isArray(block)) {
                                    return block.map((b) => (
                                        <ContentElement
                                            block={b}
                                            readonly={true}
                                            cords={{x: 0}}
                                        />
                                    ))
                                }

                                return (
                                    <ContentElement
                                        block={block}
                                        readonly={true}
                                        cords={{x: 0}}
                                    />
                                )
                            })}
                        </div>
                    </CardDetailProvider>}
                {props.visibleTitle &&
                    <div class='gallery-title'>
                        { card.fields.icon ? <div class='octo-icon'>{card.fields.icon}</div> : undefined }
                        <div
                            class='octo-titletext'
                        >
                            {card.title ||
                                <FormattedMessage
                                    id='KanbanCard.untitled'
                                    defaultMessage='Untitled'
                                />}
                        </div>
                    </div>}
                {visiblePropertyTemplates.length > 0 &&
                    <div class='gallery-props'>
                        {visiblePropertyTemplates.map((template) => (
                            <Tooltip
                                title={template.name}
                                placement='top'
                            >
                                <PropertyValueElement
                                    board={board}
                                    readOnly={true}
                                    card={card}
                                    propertyTemplate={template}
                                    showEmptyPlaceholder={false}
                                />
                            </Tooltip>
                        ))}
                    </div>}
                {props.visibleBadges &&
                    <CardBadges
                        card={card}
                        className='gallery-badges'
                    />}
            </div>
            {showConfirmationDialogBox && <ConfirmationDialogBox dialogBox={confirmDialogProps}/>}
        </>
    )
}

export default GalleryCard
