// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createMemo, createSignal, onCleanup, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl, IntlShape} from '../../intl'

import {BlockIcons} from '../../blockIcons'
import {Card} from '../../blocks/card'
import {BoardView} from '../../blocks/boardView'
import {Board} from '../../blocks/board'
import {CommentBlock} from '../../blocks/commentBlock'
import {AttachmentBlock} from '../../blocks/attachmentBlock'
import {ContentBlock} from '../../blocks/contentBlock'
import {Block, ContentBlockTypes, createBlock} from '../../blocks/block'
import mutator from '../../mutator'
import octoClient from '../../octoClient'
import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'
import {Focusable} from '../../widgets/editable'
import EditableArea from '../../widgets/editableArea'
import CompassIcon from '../../widgets/icons/compassIcon'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

import BlockIconSelector from '../blockIconSelector'

import {useAppSelector, useAppStore} from '../../store/hooks'
import {Permission} from '../../constants'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import BlocksEditor from '../blocksEditor/blocksEditor'
import {BlockData} from '../blocksEditor/blocks/types'
import {ClientConfig} from '../../config/clientConfig'
import {getClientConfig} from '../../store/clientConfig'
import type {AppStore} from '../../store'

import CardSkeleton from '../../svg/card-skeleton'
import CardAgent, {isCardAgentAvailable} from '../acp/cardAgent'
import CaseStamp from '../acp/caseStamp'
import FlowStrip, {isFlowStripAvailable} from '../acp/flowStrip'

import CommentsList from './commentsList'
import {CardDetailProvider} from './cardDetailContext'
import CardDetailContents from './cardDetailContents'
import CardDetailContentsMenu from './cardDetailContentsMenu'
import CardDetailProperties from './cardDetailProperties'
import useImagePaste from './imagePaste'
import AttachmentList from './attachment'

import './cardDetail.scss'

export const OnboardingBoardTitle = 'Welcome to Boards!'
export const OnboardingCardTitle = 'Create a new card'

type Props = {
    board: Board
    activeView: BoardView
    views: BoardView[]
    cards: Card[]
    card: Card
    comments: CommentBlock[]
    attachments: AttachmentBlock[]
    contents: Array<ContentBlock|ContentBlock[]>
    readonly: boolean
    onClose: () => void
    onDelete: (block: Block) => void
    addAttachment: () => void
}

async function addBlockNewEditor(card: Card, intl: IntlShape, title: string, fields: any, contentType: ContentBlockTypes, afterBlockId: string, actions: AppStore['actions']): Promise<Block> {
    const block = createBlock()
    block.parentId = card.id
    block.boardId = card.boardId
    block.title = title
    block.type = contentType
    block.fields = {...block.fields, ...fields}

    const description = intl.formatMessage({id: 'CardDetail.addCardText', defaultMessage: 'add card text'})

    const afterRedo = async (newBlock: Block) => {
        const contentOrder = card.fields.contentOrder.slice()
        if (afterBlockId) {
            const idx = contentOrder.indexOf(afterBlockId)
            if (idx === -1) {
                contentOrder.push(newBlock.id)
            } else {
                contentOrder.splice(idx + 1, 0, newBlock.id)
            }
        } else {
            contentOrder.push(newBlock.id)
        }
        await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
        actions.cards.updateCards([{...card, fields: {...card.fields, contentOrder}}])
    }

    const beforeUndo = async () => {
        const contentOrder = card.fields.contentOrder.slice()
        await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
    }

    const newBlock = await mutator.insertBlock(block.boardId, block, description, afterRedo, beforeUndo)
    actions.contents.updateContents([newBlock as ContentBlock])
    return newBlock
}

const CardDetail = (props: Props): JSX.Element => {
    const [title, setTitle] = createSignal(props.card.title)
    const [serverTitle, setServerTitle] = createSignal(props.card.title)
    let titleRef: Focusable | undefined

    // The card these local signals were read from. Switching cards does not
    // unmount this component — both cards are truthy, so the dialog is reused —
    // and the title signal would still hold the previous card's text.
    const editedCardId = props.card.id

    const saveTitle = () => {
        // Also runs from onCleanup, and closing a card disposes this in the
        // same tick the store stops knowing about the card — see
        // properties/baseTextEditor for the same trap. Throwing from inside
        // disposal aborts it, and the dialog stays on screen for good.
        const card = props.card
        if (!card) {
            return
        }

        // Flushing onto a card these edits did not come from renames the wrong
        // card. Losing an unsaved title when you switch cards is a fair price;
        // renaming somebody else's card is not.
        if (card.id !== editedCardId) {
            return
        }
        if (title() !== card.title) {
            mutator.changeBlockTitle(props.board.id, card.id, card.title, title())
        }
    }
    const canEditBoardCards = useHasCurrentBoardPermissions([Permission.ManageBoardCards])
    const canCommentBoardCards = useHasCurrentBoardPermissions([Permission.CommentBoardCards])

    const intl = useIntl()

    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)
    const newBoardsEditor = () => clientConfig()?.featureFlags?.newBoardsEditor || false

    useImagePaste(() => props.board.id, () => props.card.id, () => props.card.fields.contentOrder)

    onMount(() => {
        if (!title()) {
            setTimeout(() => titleRef?.focus(), 300)
        }
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ViewCard, {board: props.board.id, view: props.activeView.id, card: props.card.id})
    })

    createEffect(() => {
        if (serverTitle() === title()) {
            setTitle(props.card.title)
        }
        setServerTitle(props.card.title)
    })

    onCleanup(() => {
        saveTitle()
    })

    const setRandomIcon = () => {
        const newIcon = BlockIcons.shared.randomIcon()
        mutator.changeBlockIcon(props.board.id, props.card.id, props.card.fields.icon, newIcon)
    }

    const {actions} = useAppStore()
    createEffect(() => {
        actions.cards.setCurrent(props.card.id)
    })

    const blocks = createMemo(() => props.contents.flatMap((value: Block | Block[]): BlockData<any> => {
        const v: Block = Array.isArray(value) ? value[0] : value

        let data: any = v?.title
        if (v?.type === 'image') {
            data = {
                file: v?.fields.fileId,
            }
        }

        if (v?.type === 'attachment') {
            data = {
                file: v?.fields.fileId,
                filename: v?.fields.filename,
            }
        }

        if (v?.type === 'video') {
            data = {
                file: v?.fields.fileId,
                filename: v?.fields.filename,
            }
        }

        if (v?.type === 'checkbox') {
            data = {
                value: v?.title,
                checked: v?.fields.value,
            }
        }

        return {
            id: v?.id,
            value: data,
            contentType: v?.type,
        }
    }))

    const limited = () => props.card.limited

    return (
        <Show when={props.card}>
            <div class={`CardDetail ${limited() ? ' CardDetail--is-limited' : ''}`}>
                <BlockIconSelector
                    block={props.card}
                    size='l'
                    readonly={props.readonly || !canEditBoardCards() || limited()}
                />
                <Show when={!props.readonly && canEditBoardCards() && !props.card.fields.icon}>
                    <div class='add-buttons'>
                        <Button
                            emphasis='default'
                            size='small'
                            onClick={setRandomIcon}
                            icon={
                                <CompassIcon
                                    icon='emoticon-outline'
                                />}

                        >
                            <FormattedMessage
                                id='CardDetail.add-icon'
                                defaultMessage='Add icon'
                            />
                        </Button>
                    </div>
                </Show>

                <EditableArea
                    ref={(f) => {
                        titleRef = f
                    }}
                    class='title'
                    value={title()}
                    placeholderText='Untitled'
                    onChange={(newTitle: string) => setTitle(newTitle)}
                    saveOnEsc={true}
                    onSave={saveTitle}
                    onCancel={() => setTitle(props.card.title)}
                    readonly={props.readonly || !canEditBoardCards() || limited()}
                    spellCheck={true}
                />

                {/* Where the work on this card lives, stamped under its name. */}
                <Show when={!limited() && isCardAgentAvailable()}>
                    <CaseStamp cardId={props.card.id}/>
                </Show>

                {/* Hidden (limited) card copy + CTA */}

                <Show when={limited()}>
                    <div class='CardDetail__limited-wrapper'>
                        <CardSkeleton
                            class='CardDetail__limited-bg'
                        />
                        <p class='CardDetail__limited-title'>
                            <FormattedMessage
                                id='CardDetail.limited-title'
                                defaultMessage='This card is hidden'
                            />
                        </p>
                        <p class='CardDetail__limited-body'>
                            <FormattedMessage
                                id='CardDetail.limited-body'
                                defaultMessage='Upgrade to our Professional or Enterprise plan to view archived cards, have unlimited views per boards, unlimited cards and more.'
                            />
                            <br/>
                            <a
                                class='CardDetail__limited-link'
                                role='button'
                                onClick={() => {
                                    props.onClose();
                                    (window as any).openPricingModal()({trackingLocation: 'boards > learn_more_about_our_plans_click'})
                                }}
                            >
                                <FormattedMessage
                                    id='CardDetial.limited-link'
                                    defaultMessage='Learn more about our plans.'
                                />
                            </a>
                        </p>
                        <Button
                            class='CardDetail__limited-button'
                            onClick={() => {
                                props.onClose();
                                (window as any).openPricingModal()({trackingLocation: 'boards > upgrade_click'})
                            }}
                            emphasis='primary'
                            size='large'
                        >
                            {intl.formatMessage({id: 'CardDetail.limited-button', defaultMessage: 'Upgrade'})}
                        </Button>
                    </div>
                </Show>

                {/* Property list */}

                <Show when={!limited()}>
                    <CardDetailProperties
                        board={props.board}
                        card={props.card}
                        cards={props.cards}
                        activeView={props.activeView}
                        views={props.views}
                        readonly={props.readonly}
                    />
                </Show>

                <Show when={props.attachments.length !== 0}>
                    <hr/>
                    <AttachmentList
                        attachments={props.attachments}
                        onDelete={props.onDelete}
                        addAttachment={props.addAttachment}
                    />
                </Show>

                {/* Agent session console (desktop app only) */}

                <Show when={!limited() && !props.readonly && isFlowStripAvailable()}>
                    <hr/>
                    <FlowStrip cardId={props.card.id}/>
                </Show>

                <Show when={!limited() && !props.readonly && isCardAgentAvailable()}>
                    <hr/>
                    <CardAgent cardId={props.card.id}/>
                </Show>

                {/* Comments */}

                <Show when={!limited()}>
                    <hr/>
                    <CommentsList
                        comments={props.comments}
                        boardId={props.card.boardId}
                        cardId={props.card.id}
                        readonly={props.readonly || !canCommentBoardCards()}
                    />
                </Show>
            </div>

            {/* Content blocks */}

            <Show when={!limited()}>
                <div class='CardDetail CardDetail--fullwidth content-blocks'>
                    <Show
                        when={newBoardsEditor()}
                        fallback={
                            <CardDetailProvider card={props.card}>
                                <CardDetailContents
                                    card={props.card}
                                    contents={props.contents}
                                    readonly={props.readonly || !canEditBoardCards()}
                                />
                                <Show when={!props.readonly && canEditBoardCards()}>
                                    <CardDetailContentsMenu/>
                                </Show>
                            </CardDetailProvider>
                        }
                    >
                        <BlocksEditor
                            boardId={props.card.boardId}
                            blocks={blocks()}
                            onBlockCreated={async (block: any, afterBlock: any): Promise<BlockData|null> => {
                                if (block.contentType === 'text' && block.value === '') {
                                    return null
                                }
                                let newBlock: Block
                                if (block.contentType === 'checkbox') {
                                    newBlock = await addBlockNewEditor(props.card, intl, block.value.value, {value: block.value.checked}, block.contentType, afterBlock?.id, actions)
                                } else if (block.contentType === 'image' || block.contentType === 'attachment' || block.contentType === 'video') {
                                    const newFileId = await octoClient.uploadFile(props.card.boardId, block.value.file)
                                    newBlock = await addBlockNewEditor(props.card, intl, '', {fileId: newFileId, filename: block.value.filename}, block.contentType, afterBlock?.id, actions)
                                } else {
                                    newBlock = await addBlockNewEditor(props.card, intl, block.value, {}, block.contentType, afterBlock?.id, actions)
                                }
                                return {...block, id: newBlock.id}
                            }}
                            onBlockModified={async (block: any): Promise<BlockData<any>|null> => {
                                const originalContentBlock = props.contents.flatMap((b) => b).find((b) => b.id === block.id)
                                if (!originalContentBlock) {
                                    return null
                                }

                                if (block.contentType === 'text' && block.value === '') {
                                    const description = intl.formatMessage({id: 'ContentBlock.DeleteAction', defaultMessage: 'delete'})

                                    mutator.deleteBlock(originalContentBlock, description)
                                    return null
                                }
                                const newBlock = {
                                    ...originalContentBlock,
                                    title: block.value,
                                }

                                if (block.contentType === 'checkbox') {
                                    newBlock.title = block.value.value
                                    newBlock.fields = {...newBlock.fields, value: block.value.checked}
                                }
                                mutator.updateBlock(props.card.boardId, newBlock, originalContentBlock, intl.formatMessage({id: 'ContentBlock.editCardText', defaultMessage: 'edit card content'}))
                                return block
                            }}
                            onBlockMoved={async (block: BlockData, beforeBlock: BlockData|null, afterBlock: BlockData|null): Promise<void> => {
                                if (block.id) {
                                    const idx = props.card.fields.contentOrder.indexOf(block.id)
                                    let sourceBlockId: string
                                    let sourceWhere: 'after'|'before'
                                    if (idx === -1) {
                                        Utils.logError('Unable to find the block id in the order of the current block')
                                        return
                                    }
                                    if (idx === 0) {
                                        sourceBlockId = props.card.fields.contentOrder[1] as string
                                        sourceWhere = 'before'
                                    } else {
                                        sourceBlockId = props.card.fields.contentOrder[idx - 1] as string
                                        sourceWhere = 'after'
                                    }
                                    if (afterBlock && afterBlock.id) {
                                        await mutator.moveContentBlock(block.id, afterBlock.id, 'after', sourceBlockId, sourceWhere, intl.formatMessage({id: 'ContentBlock.moveBlock', defaultMessage: 'move card content'}))
                                        return
                                    }
                                    if (beforeBlock && beforeBlock.id) {
                                        await mutator.moveContentBlock(block.id, beforeBlock.id, 'before', sourceBlockId, sourceWhere, intl.formatMessage({id: 'ContentBlock.moveBlock', defaultMessage: 'move card content'}))
                                    }
                                }
                            }}
                        />
                    </Show>
                </div>
            </Show>
        </Show>
    )
}

export default CardDetail
