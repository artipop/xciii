// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, batch, createEffect, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useNavigate} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../../intl'

import Workspace from '../../components/workspace'
import VersionMessage from '../../components/messages/versionMessage'
import octoClient from '../../octoClient'
import {Subscription, WSClient} from '../../wsclient'
import {Utils} from '../../utils'
import {useWebsockets} from '../../hooks/websockets'
import {useRouteMatch} from '../../hooks/routerMatch'
import {IUser} from '../../user'
import {Block} from '../../blocks/block'
import {ContentBlock} from '../../blocks/contentBlock'
import {CommentBlock} from '../../blocks/commentBlock'
import {AttachmentBlock} from '../../blocks/attachmentBlock'
import {Board, BoardMember} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import {getCurrentBoardId} from '../../store/boards'
import {getCurrentViewId} from '../../store/views'
import ConfirmationDialog from '../../components/confirmationDialogBox'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {
    getMe,
} from '../../store/users'
import {UserSettings} from '../../userSettings'

import IconButton from '../../widgets/buttons/iconButton'
import CloseIcon from '../../widgets/icons/close'

import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

import {Constants} from '../../constants'

import {getCategoryOfBoard, getHiddenBoardIDs} from '../../store/sidebar'

import SetWindowTitleAndIcon from './setWindowTitleAndIcon'
import TeamToBoardAndViewRedirect from './teamToBoardAndViewRedirect'
import UndoRedoHotKeys from './undoRedoHotKeys'
import BackwardCompatibilityQueryParamsRedirect from './backwardCompatibilityQueryParamsRedirect'
import WebsocketConnection from './websocketConnection'

import './boardPage.scss'

type Props = {
    readonly?: boolean
    new?: boolean
}

const BoardPage = (props: Props): JSX.Element => {
    const intl = useIntl()
    const activeBoardId = useAppSelector(getCurrentBoardId)
    const activeViewId = useAppSelector(getCurrentViewId)
    const {actions} = useAppStore()
    const match = useRouteMatch()
    const [mobileWarningClosed, setMobileWarningClosed] = createSignal(UserSettings.mobileWarningClosed)
    const teamId = () => match().params.teamId || UserSettings.lastTeamId || Constants.globalTeamId
    const viewId = () => match().params.viewId
    const boardId = () => match().params.boardId
    const me = useAppSelector<IUser|null>(getMe)
    const hiddenBoardIDs = useAppSelector(getHiddenBoardIDs)
    const category = useAppSelector((state) => getCategoryOfBoard(activeBoardId())(state))
    const [showJoinBoardDialog, setShowJoinBoardDialog] = createSignal<boolean>(false)
    const navigate = useNavigate()

    // if we're in a legacy route and not showing a shared board,
    // redirect to the new URL schema equivalent
    if (Utils.isFocalboardLegacy() && !props.readonly) {
        window.location.href = window.location.href.replace('/plugins/focalboard', '/boards')
    }

    // TODO: Make this less brittle. This only works because this is the root render function
    createEffect(() => {
        UserSettings.lastTeamId = teamId()
        octoClient.teamId = teamId()
        actions.teams.setTeam(teamId())
    })

    const loadAction = (id: string) => {
        if (props.readonly) {
            return actions.load.initialReadOnlyLoad(id)
        }
        return actions.load.initialLoad()
    }

    useWebsockets(teamId, (wsClient) => {
        const incrementalBlockUpdate = (_: WSClient, blocks: Block[]) => {
            const teamBlocks = blocks

            batch(() => {
                actions.views.updateViews(teamBlocks.filter((b: Block) => b.type === 'view' || b.deleteAt !== 0) as BoardView[])
                actions.cards.updateCards(teamBlocks.filter((b: Block) => b.type === 'card' || b.deleteAt !== 0) as Card[])
                actions.comments.updateComments(teamBlocks.filter((b: Block) => b.type === 'comment' || b.deleteAt !== 0) as CommentBlock[])
                actions.attachments.updateAttachments(teamBlocks.filter((b: Block) => b.type === 'attachment' || b.deleteAt !== 0) as AttachmentBlock[])
                actions.contents.updateContents(teamBlocks.filter((b: Block) => b.type !== 'card' && b.type !== 'view' && b.type !== 'board' && b.type !== 'comment' && b.type !== 'attachment') as ContentBlock[])
            })
        }

        const incrementalBoardUpdate = (_: WSClient, boards: Board[]) => {
            // only takes into account the entities that belong to the team or the user boards
            const teamBoards = boards.filter((b: Board) => b.teamId === Constants.globalTeamId || b.teamId === teamId())
            const activeBoard = teamBoards.find((b: Board) => b.id === activeBoardId())
            actions.boards.updateBoards(teamBoards)

            if (activeBoard) {
                actions.boards.fetchBoardMembers({
                    teamId: teamId(),
                    boardId: activeBoardId(),
                })
            }
        }

        const incrementalBoardMemberUpdate = (_: WSClient, members: BoardMember[]) => {
            actions.boards.updateMembersEnsuringBoardsAndUsers(members)

            const user = me()
            if (user) {
                const myBoardMemberships = members.filter((boardMember) => boardMember.userId === user.id)
                actions.boards.addMyBoardMemberships(myBoardMemberships)
            }
        }

        const dispatchLoadAction = () => {
            loadAction(boardId())
        }

        Utils.log('useWEbsocket adding onChange handler')
        wsClient.addOnChange(incrementalBlockUpdate, 'block')
        wsClient.addOnChange(incrementalBoardUpdate, 'board')
        wsClient.addOnChange(incrementalBoardMemberUpdate, 'boardMembers')
        wsClient.addOnReconnect(dispatchLoadAction)

        wsClient.setOnFollowBlock((_: WSClient, subscription: Subscription): void => {
            if (subscription.subscriberId === me()?.id) {
                actions.users.followBlock(subscription)
            }
        })
        wsClient.setOnUnfollowBlock((_: WSClient, subscription: Subscription): void => {
            if (subscription.subscriberId === me()?.id) {
                actions.users.unfollowBlock(subscription)
            }
        })

        return () => {
            Utils.log('useWebsocket cleanup')
            wsClient.removeOnChange(incrementalBlockUpdate, 'block')
            wsClient.removeOnChange(incrementalBoardUpdate, 'board')
            wsClient.removeOnChange(incrementalBoardMemberUpdate, 'boardMembers')
            wsClient.removeOnReconnect(dispatchLoadAction)
        }
    })

    const onConfirmJoin = async () => {
        const user = me()
        if (user) {
            joinBoard(user, teamId(), boardId(), true)
            setShowJoinBoardDialog(false)
        }
    }

    const joinBoard = async (myUser: IUser, boardTeamId: string, joinBoardId: string, allowAdmin: boolean) => {
        const member = await octoClient.joinBoard(joinBoardId, allowAdmin)
        if (!member) {
            if (myUser.permissions?.find((s) => s === 'manage_system' || s === 'manage_team')) {
                setShowJoinBoardDialog(true)
                return
            }
            UserSettings.setLastBoardID(boardTeamId, null)
            UserSettings.setLastViewId(joinBoardId, null)
            actions.globalError.setGlobalError('board-not-found')
            return
        }
        const result = await actions.load.loadBoardData(joinBoardId)
        if (result.blocks.length > 0 && myUser.id) {
            // set board as most recently viewed board
            UserSettings.setLastBoardID(boardTeamId, joinBoardId)
        }
    }

    const loadOrJoinBoard = async (myUser: IUser, boardTeamId: string, loadBoardId: string) => {
        // and fetch its data
        const result = await actions.load.loadBoardData(loadBoardId)
        if (result.blocks.length === 0 && myUser.id) {
            joinBoard(myUser, boardTeamId, loadBoardId, false)
        } else {
            // set board as most recently viewed board
            UserSettings.setLastBoardID(boardTeamId, loadBoardId)
        }

        actions.boards.fetchBoardMembers({
            teamId: boardTeamId,
            boardId: loadBoardId,
        })
    }

    createEffect(() => {
        void teamId()
        void me()?.id
        const currentBoardId = boardId()
        const currentViewId = viewId()
        loadAction(currentBoardId)

        if (currentBoardId) {
            // set the active board
            actions.boards.setCurrent(currentBoardId)

            if (currentViewId !== Constants.globalTeamId) {
                // reset current, even if empty string
                actions.views.setCurrent(currentViewId || '')
                if (currentViewId) {
                    // don't reset per board if empty string
                    UserSettings.setLastViewId(currentBoardId, currentViewId)
                }
            }
        }
    })

    createEffect(() => {
        const user = me()
        if (boardId() && !props.readonly && user) {
            loadOrJoinBoard(user, teamId(), boardId())
        }
    })

    const handleUnhideBoard = async (boardID: string) => {
        if (!me() || !category()) {
            return
        }

        await octoClient.unhideBoard(category()!.id, boardID)
    }

    createEffect(() => {
        void me()?.id
        if (!teamId() || !boardId()) {
            return
        }

        if (hiddenBoardIDs().indexOf(boardId()!) >= 0) {
            handleUnhideBoard(boardId()!)
        }
    })

    createEffect(() => {
        if (props.readonly && activeBoardId() && activeViewId()) {
            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ViewSharedBoard, {board: activeBoardId(), view: activeViewId()})
        }
    })

    return (
        <Show
            when={!showJoinBoardDialog()}
            fallback={
                <ConfirmationDialog
                    dialogBox={{
                        heading: intl.formatMessage({id: 'boardPage.confirm-join-title', defaultMessage: 'Join private board'}),
                        subText: intl.formatMessage({
                            id: 'boardPage.confirm-join-text',
                            defaultMessage: 'You are about to join a private board without explicitly being added by the board admin. Are you sure you wish to join this private board?',
                        }),
                        confirmButtonText: intl.formatMessage({id: 'boardPage.confirm-join-button', defaultMessage: 'Join'}),
                        destructive: true, //board.channelId !== '',

                        onConfirm: onConfirmJoin,
                        onClose: () => {
                            setShowJoinBoardDialog(false)
                            navigate(-1)
                        },
                    }}
                />
            }
        >
            <div class='BoardPage'>
                <Show when={!props.new}>
                    <TeamToBoardAndViewRedirect/>
                </Show>
                <BackwardCompatibilityQueryParamsRedirect/>
                <SetWindowTitleAndIcon/>
                <UndoRedoHotKeys/>
                <WebsocketConnection/>
                <VersionMessage/>

                <Show when={!mobileWarningClosed()}>
                    <div class='mobileWarning'>
                        <div>
                            <FormattedMessage
                                id='Error.mobileweb'
                                defaultMessage='Mobile web support is currently in early beta. Not all functionality may be present.'
                            />
                        </div>
                        <IconButton
                            onClick={() => {
                                UserSettings.mobileWarningClosed = true
                                setMobileWarningClosed(true)
                            }}
                            icon={<CloseIcon/>}
                            title='Close'
                            className='margin-right'
                        />
                    </div>
                </Show>

                <Show when={props.readonly && activeBoardId() === undefined}>
                    <div class='error'>
                        {intl.formatMessage({id: 'BoardPage.syncFailed', defaultMessage: 'Board may be deleted or access revoked.'})}
                    </div>
                </Show>

                {/* Don't display Templates page if readonly mode and no board defined. */}
                <Show when={!props.readonly || activeBoardId() !== undefined}>
                    <Workspace
                        readonly={props.readonly || false}
                    />
                </Show>
            </div>
        </Show>
    )
}

export default BoardPage
