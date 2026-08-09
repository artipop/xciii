// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {useIntl} from '../../intl'

import DeleteIcon from '../../widgets/icons/delete'
import Menu from '../../widgets/menu'
import BoardPermissionGate from '../permissions/boardPermissionGate'
import DuplicateIcon from '../../widgets/icons/duplicate'
import LinkIcon from '../../widgets/icons/Link'
import BoardIcon from '../../widgets/icons/board'
import {openMoveCardToBoard} from '../moveCardToBoard'
import {Utils} from '../../utils'
import {Permission} from '../../constants'
import {sendFlashMessage} from '../flashMessages'
import {IUser} from '../../user'
import {getMe} from '../../store/users'
import {useAppSelector} from '../../store/hooks'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

type Props = {
    cardId: string
    boardId: string
    onClickDelete: () => void
    onClickDuplicate?: () => void
}

export const CardActionsMenu: ParentComponent<Props> = (props): JSX.Element => {
    const me = useAppSelector<IUser|null>(getMe)
    const intl = useIntl()

    const handleDeleteCard = () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DeleteCard, {board: props.boardId, card: props.cardId})
        props.onClickDelete()
    }

    const handleDuplicateCard = () => {
        if (props.onClickDuplicate) {
            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DuplicateCard, {board: props.boardId, card: props.cardId})
            props.onClickDuplicate()
        }
    }

    return (
        <Menu position='left'>
            <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                <Menu.Text
                    icon={<DeleteIcon/>}
                    id='delete'
                    name={intl.formatMessage({id: 'CardActionsMenu.delete', defaultMessage: 'Delete'})}
                    onClick={handleDeleteCard}
                />
                <Show when={props.onClickDuplicate}>
                    <Menu.Text
                        icon={<DuplicateIcon/>}
                        id='duplicate'
                        name={intl.formatMessage({id: 'CardActionsMenu.duplicate', defaultMessage: 'Duplicate'})}
                        onClick={handleDuplicateCard}
                    />
                </Show>
                {/* The dialog is not rendered here: this menu unmounts the
                    moment it is clicked, and a dialog inside it would go with
                    it. It is asked for instead, and mounted once in app.tsx. */}
                <Menu.Text
                    icon={<BoardIcon/>}
                    id='moveToBoard'
                    name={intl.formatMessage({id: 'CardActionsMenu.moveToBoard', defaultMessage: 'Move to a board…'})}
                    onClick={() => openMoveCardToBoard(props.cardId)}
                />
            </BoardPermissionGate>
            <Show when={me()?.id !== 'single-user'}>
                <Menu.Text
                    icon={<LinkIcon/>}
                    id='copy'
                    name={intl.formatMessage({id: 'CardActionsMenu.copyLink', defaultMessage: 'Copy link'})}
                    onClick={() => {
                        let cardLink = window.location.href

                        if (!cardLink.includes(props.cardId)) {
                            cardLink += `/${props.cardId}`
                        }

                        Utils.copyTextToClipboard(cardLink)
                        sendFlashMessage({content: intl.formatMessage({id: 'CardActionsMenu.copiedLink', defaultMessage: 'Copied!'}), severity: 'high'})
                    }}
                />
            </Show>
            {props.children}
        </Menu>
    )
}

export default CardActionsMenu
