import {Show, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../intl'

import {Board} from '../blocks/board'
import {BoardView} from '../blocks/boardView'
import {Card} from '../blocks/card'
import {sendFlashMessage} from '../components/flashMessages'
import mutator from '../mutator'
import octoClient from '../octoClient'
import {getCardAttachments} from '../store/attachments'
import {getCard} from '../store/cards'
import {getCardComments} from '../store/comments'
import {getCardContents} from '../store/contents'
import {useAppSelector, useAppStore} from '../store/hooks'
import {Utils} from '../utils'
import CompassIcon from '../widgets/icons/compassIcon'
import Menu from '../widgets/menu'

import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../components/confirmationDialogBox'

import Button from '../widgets/buttons/button'

import {AttachmentBlock, createAttachmentBlock} from '../blocks/attachmentBlock'
import {Block, createBlock} from '../blocks/block'
import {Permission} from '../constants'

import BoardPermissionGate from './permissions/boardPermissionGate'

import CardTerminal, {isCardTerminalAvailable} from './acp/cardTerminal'
import {cardAgentState, refreshCardAgent} from './acp/cardAgentState'
import {refreshRegisteredAgents, registeredAgents} from './acp/agentRegistry'

import CardDetail from './cardDetail/cardDetail'
import Dialog from './dialog'

import CardActionsMenu from './cardActionsMenu/cardActionsMenu'
import './cardDialog.scss'

type Props = {
    board: Board
    activeView: BoardView
    views: BoardView[]
    cards: Card[]
    cardId: string
    onClose: () => void
    showCard: (cardId?: string) => void
    readonly: boolean
}

const CardDialog = (props: Props): JSX.Element => {
    const card = useAppSelector((state) => getCard(props.cardId)(state))
    const contents = useAppSelector((state) => getCardContents(props.cardId)(state))
    const comments = useAppSelector((state) => getCardComments(props.cardId)(state))
    const attachments = useAppSelector((state) => getCardAttachments(props.cardId)(state))
    const intl = useIntl()
    const {actions} = useAppStore()
    const isTemplate = () => card() && card()!.fields.isTemplate

    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)
    const [showTerminal, setShowTerminal] = createSignal<boolean>(false)
    const makeTemplateClicked = async () => {
        const currentCard = card()
        if (!currentCard) {
            Utils.assertFailure('card')
            return
        }

        await mutator.duplicateCard(
            props.cardId,
            props.board.id,
            currentCard.fields.isTemplate,
            intl.formatMessage({id: 'Mutator.new-template-from-card', defaultMessage: 'new template from card'}),
            true,
            {},
            async (newCardId) => {
                props.showCard(newCardId)
            },
            async () => {
                props.showCard(undefined)
            },
        )
    }
    const handleDeleteCard = async () => {
        const currentCard = card()
        if (!currentCard) {
            Utils.assertFailure()
            return
        }
        await mutator.deleteBlock(currentCard, 'delete card')
        props.onClose()
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
        // use may be renaming a card title
        // and accidently delete the card
        // so adding des
        if (card()?.title === '' && card()?.fields.contentOrder.length === 0) {
            handleDeleteCard()
            return
        }

        setShowConfirmationDialogBox(true)
    }

    const menu = () => (
        <CardActionsMenu
            cardId={props.cardId}
            boardId={props.board.id}
            onClickDelete={handleDeleteButtonOnClick}
        >
            <Show when={!isTemplate()}>
                <BoardPermissionGate permissions={[Permission.ManageBoardProperties]}>
                    <Menu.Text
                        id='makeTemplate'
                        icon={
                            <CompassIcon
                                icon='plus'
                            />}
                        name={intl.formatMessage({id: 'CardDialog.new-template-from-card', defaultMessage: 'New template from card'})}
                        onClick={makeTemplateClicked}
                    />
                </BoardPermissionGate>
            </Show>
        </CardActionsMenu>
    )

    const removeUploadingAttachment = (uploadingBlock: Block) => {
        uploadingBlock.deleteAt = 1
        const removeUploadingAttachmentBlock = createAttachmentBlock(uploadingBlock)
        actions.attachments.updateAttachments([removeUploadingAttachmentBlock])
    }

    const selectAttachment = (boardId: string) => {
        return new Promise<AttachmentBlock>(
            (resolve) => {
                Utils.selectLocalFile(async (attachment) => {
                    const uploadingBlock = createBlock()
                    uploadingBlock.title = attachment.name
                    uploadingBlock.fields.fileId = attachment.name
                    uploadingBlock.boardId = boardId
                    const currentCard = card()
                    if (currentCard) {
                        uploadingBlock.parentId = currentCard.id
                    }
                    const attachmentBlock = createAttachmentBlock(uploadingBlock)
                    attachmentBlock.isUploading = true
                    actions.attachments.updateAttachments([attachmentBlock])
                    sendFlashMessage({content: intl.formatMessage({id: 'AttachmentBlock.upload', defaultMessage: 'Attachment uploading.'}), severity: 'normal'})
                    const xhr = await octoClient.uploadAttachment(boardId, attachment)
                    if (xhr) {
                        xhr.upload.onprogress = (event) => {
                            const percent = Math.floor((event.loaded / event.total) * 100)
                            actions.attachments.updateUploadPrecent({
                                blockId: attachmentBlock.id,
                                uploadPercent: percent,
                            })
                        }

                        xhr.onload = () => {
                            if (xhr.status === 200 && xhr.readyState === 4) {
                                const json = JSON.parse(xhr.response)
                                const fileId = json.fileId
                                if (fileId) {
                                    removeUploadingAttachment(uploadingBlock)
                                    const block = createAttachmentBlock()
                                    block.fields.fileId = fileId || ''
                                    block.title = attachment.name
                                    sendFlashMessage({content: intl.formatMessage({id: 'AttachmentBlock.uploadSuccess', defaultMessage: 'Attachment uploaded successfull.'}), severity: 'normal'})
                                    resolve(block)
                                } else {
                                    removeUploadingAttachment(uploadingBlock)
                                    sendFlashMessage({content: intl.formatMessage({id: 'AttachmentBlock.failed', defaultMessage: 'Unable to upload the file. Attachment size limit reached.'}), severity: 'normal'})
                                }
                            }
                        }
                    }
                },
                '')
            },
        )
    }

    const addElement = async () => {
        const currentCard = card()
        if (!currentCard) {
            return
        }
        const block = await selectAttachment(props.board.id)
        block.parentId = currentCard.id
        block.boardId = currentCard.boardId
        const typeName = block.type
        const description = intl.formatMessage({id: 'AttachmentBlock.addElement', defaultMessage: 'add {type}'}, {type: typeName})
        await mutator.insertBlock(block.boardId, block, description)
    }

    const deleteBlock = async (block: Block) => {
        if (!card()) {
            return
        }
        const description = intl.formatMessage({id: 'AttachmentBlock.DeleteAction', defaultMessage: 'delete'})
        await mutator.deleteBlock(block, description)
        sendFlashMessage({content: intl.formatMessage({id: 'AttachmentBlock.delete', defaultMessage: 'Attachment Deleted Successfully.'}), severity: 'normal'})
    }

    const attachBtn = (): JSX.Element => {
        return (
            <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                <Button
                    icon={<CompassIcon icon='paperclip'/>}
                    class='cardFollowBtn cardFollowBtn--attach'
                    emphasis='gray'
                    size='medium'
                    onClick={addElement}
                >
                    {intl.formatMessage({id: 'CardDetail.Attach', defaultMessage: 'Attach'})}
                </Button>
            </BoardPermissionGate>
        )
    }

    // The terminal is a panel beside the card, and this is what opens it. It
    // sits in the dialog's own toolbar rather than in the card's body: the card
    // is what a person wrote, and the machinery for working it belongs to the
    // frame around it.
    const agentState = cardAgentState(props.cardId)
    onMount(() => {
        if (isCardTerminalAvailable()) {
            refreshRegisteredAgents()
            refreshCardAgent(props.cardId)
        }
    })

    // A card already worked keeps its terminal button whatever the registry
    // says today — the worktree is still there to go back to. Everything else
    // waits for there to be an agent to run at all.
    const offersTerminal = () => isCardTerminalAvailable() && Boolean(card()) && !props.readonly &&
        Boolean(agentState().running || agentState().resume?.available || (registeredAgents() || 0) > 0)

    const terminalBtn = (): JSX.Element => (
        <Show when={offersTerminal()}>
            <Button
                icon={<CompassIcon icon='console'/>}
                class='cardFollowBtn cardFollowBtn--attach'
                emphasis='gray'
                size='medium'
                onClick={() => setShowTerminal(!showTerminal())}
            >
                {intl.formatMessage({id: 'CardDialog.terminal', defaultMessage: 'Terminal'})}
            </Button>
        </Show>
    )

    return (
        <>
            <Dialog
                title={<div/>}
                class='cardDialog'
                onClose={props.onClose}
                toolsMenu={!props.readonly && menu()}
                toolbar={<>{terminalBtn()}{attachBtn()}</>}
            >
                <Show when={isTemplate()}>
                    <div class='banner'>
                        <FormattedMessage
                            id='CardDialog.editing-template'
                            defaultMessage="You're editing a template."
                        />
                    </div>
                </Show>

                {/* Two panels: the card on one side, the terminal on the
                    other. The card scrolls on its own so the terminal keeps
                    the dialog's full height rather than travelling with the
                    card's own content. */}
                <div class='cardDialog__body'>
                    <div class='cardDialog__main'>
                        <Show
                            when={card()}
                            fallback={
                                <div class='banner error'>
                                    <FormattedMessage
                                        id='CardDialog.nocard'
                                        defaultMessage="This card doesn't exist or is inaccessible."
                                    />
                                </div>
                            }
                        >
                            <CardDetail
                                board={props.board}
                                activeView={props.activeView}
                                views={props.views}
                                cards={props.cards}
                                card={card()!}
                                contents={contents()}
                                comments={comments()}
                                attachments={attachments()}
                                readonly={props.readonly}
                                onClose={props.onClose}
                                onDelete={deleteBlock}
                                addAttachment={addElement}
                            />
                        </Show>
                    </div>

                    <Show when={showTerminal() && offersTerminal()}>
                        <div class='cardDialog__side'>
                            <CardTerminal
                                cardId={props.cardId}
                                board={props.board}
                                onClose={() => setShowTerminal(false)}
                            />
                        </div>
                    </Show>
                </div>
            </Dialog>

            <Show when={showConfirmationDialogBox()}>
                <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
            </Show>
        </>
    )
}

export default CardDialog
