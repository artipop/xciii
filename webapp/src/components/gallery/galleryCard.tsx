import {For, Show, createSignal} from 'solid-js'

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
    const [isDragging, isOver, cardRef] = useSortable('card', () => props.card, () => props.isManualSort && !props.readonly, (src, dst) => props.onDrop(src, dst))
    const contents = useAppSelector((state) => getCardContents(props.card.id)(state))
    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)

    const visiblePropertyTemplates = () => props.visiblePropertyTemplates || []

    const handleDeleteCard = () => {
        mutator.deleteBlock(props.card, 'delete card')
    }

    const confirmDialogProps: ConfirmationDialogBoxProps = {
        heading: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-heading', defaultMessage: 'Confirm card delete!'}),
        confirmButtonText: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-button-text', defaultMessage: 'Delete'}),
        onConfirm: handleDeleteCard,
        onClose: () => {
            setShowConfirmationDialogBox(false)
        },
    }

    const image = (): ContentBlock|undefined => {
        const current = contents()
        for (let i = 0; i < current.length; ++i) {
            if (Array.isArray(current[i])) {
                return (current[i] as ContentBlock[]).find((c) => c.type === 'image')
            } else if ((current[i] as ContentBlock).type === 'image') {
                return current[i] as ContentBlock
            }
        }
        return undefined
    }

    const classes = () => {
        let name = props.isSelected ? 'GalleryCard selected' : 'GalleryCard'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }

    return (
        <>
            <div
                class={classes()}
                onClick={(e: MouseEvent) => props.onClick(e, props.card)}
                style={{opacity: isDragging() ? 0.5 : 1}}
                ref={cardRef}
            >
                <Show when={!props.readonly}>
                    <MenuWrapper
                        class='optionsMenu'
                        stopPropagationOnToggle={true}
                        menu={
                            <CardActionsMenu
                                cardId={props.card!.id}
                                boardId={props.card!.boardId}
                                onClickDelete={() => setShowConfirmationDialogBox(true)}
                                onClickDuplicate={() => {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DuplicateCard, {board: props.board.id, card: props.card.id})
                                    mutator.duplicateCard(props.card.id, props.board.id)
                                }}
                            />
                        }
                    >
                        <CardActionsMenuIcon/>
                    </MenuWrapper>
                </Show>

                <Show
                    when={image()}
                    fallback={
                        <CardDetailProvider card={props.card}>
                            <div class='gallery-item'>
                                <For each={contents()}>
                                    {(block) => {
                                        if (Array.isArray(block)) {
                                            return (
                                                <For each={block}>
                                                    {(b) => (
                                                        <ContentElement
                                                            block={b}
                                                            readonly={true}
                                                            cords={{x: 0}}
                                                        />
                                                    )}
                                                </For>
                                            )
                                        }

                                        return (
                                            <ContentElement
                                                block={block as ContentBlock}
                                                readonly={true}
                                                cords={{x: 0}}
                                            />
                                        )
                                    }}
                                </For>
                            </div>
                        </CardDetailProvider>
                    }
                >
                    <div class='gallery-image'>
                        <ImageElement block={image()!}/>
                    </div>
                </Show>
                <Show when={props.visibleTitle}>
                    <div class='gallery-title'>
                        <Show when={props.card.fields.icon}>
                            <div class='octo-icon'>{props.card.fields.icon}</div>
                        </Show>
                        <div
                            class='octo-titletext'
                        >
                            {props.card.title ||
                                <FormattedMessage
                                    id='KanbanCard.untitled'
                                    defaultMessage='Untitled'
                                />}
                        </div>
                    </div>
                </Show>
                <Show when={visiblePropertyTemplates().length > 0}>
                    <div class='gallery-props'>
                        <For each={visiblePropertyTemplates()}>
                            {(template) => (
                                <Tooltip
                                    title={template.name}
                                    placement='top'
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
                    </div>
                </Show>
                <Show when={props.visibleBadges}>
                    <CardBadges
                        card={props.card}
                        class='gallery-badges'
                    />
                </Show>
            </div>
            <Show when={showConfirmationDialogBox()}>
                <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
            </Show>
        </>
    )
}

export default GalleryCard
