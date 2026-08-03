// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {Utils} from '../../utils'

import IconButton from '../buttons/iconButton'
import CloseIcon from '../icons/close'
import Tooltip from '../tooltip'

import './notificationBox.scss'

type Props = {
    title: string
    icon?: JSX.Element
    children?: JSX.Element
    onClose?: () => void
    closeTooltip?: string
    className?: string
}

function renderClose(onClose?: () => void, closeTooltip?: string) {
    if (!onClose) {
        return null
    }

    if (closeTooltip) {
        return (
            <Tooltip title={closeTooltip}>
                <IconButton
                    icon={<CloseIcon/>}
                    onClick={onClose}
                />
            </Tooltip>
        )
    }

    return (
        <IconButton
            icon={<CloseIcon/>}
            onClick={onClose}
        />
    )
}

function NotificationBox(props: Props): JSX.Element {
    const className = Utils.generateClassName({
        NotificationBox: true,
        [props.className || '']: Boolean(props.className),
    })

    return (
        <div class={className}>
            {props.icon &&
                <div class='NotificationBox__icon'>
                    {props.icon}
                </div>}
            <div class='content'>
                <p class='title'>{props.title}</p>
                {props.children}
            </div>
            {renderClose(props.onClose, props.closeTooltip)}
        </div>
    )
}

export default NotificationBox
