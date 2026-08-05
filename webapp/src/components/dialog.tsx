// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {useIntl} from '../intl'

import {useHotkeys} from '../hooks/hotkeys'
import IconButton from '../widgets/buttons/iconButton'
import CloseIcon from '../widgets/icons/close'
import OptionsIcon from '../widgets/icons/options'
import MenuWrapper from '../widgets/menuWrapper'
import './dialog.scss'

type Props = {
    size?: string
    toolsMenu?: JSX.Element // some dialogs may not  require a toolmenu
    toolbar?: JSX.Element
    hideCloseButton?: boolean
    class?: string
    title?: JSX.Element
    subtitle?: JSX.Element
    onClose: () => void
}

const Dialog: ParentComponent<Props> = (props) => {
    const intl = useIntl()

    const closeDialogText = intl.formatMessage({
        id: 'Dialog.closeDialog',
        defaultMessage: 'Close dialog',
    })

    useHotkeys('esc', () => props.onClose())

    let isBackdropClicked = false

    return (
        <div class={`Dialog dialog-back ${props.class} size--${props.size || 'medium'}`}>
            <div class='backdrop'/>
            <div
                class='wrapper'
                onClick={(e) => {
                    e.stopPropagation()
                    if (!isBackdropClicked) {
                        return
                    }
                    isBackdropClicked = false
                    props.onClose()
                }}
                onMouseDown={(e) => {
                    if (e.target === e.currentTarget) {
                        isBackdropClicked = true
                    }
                }}
            >
                <div
                    role='dialog'
                    class='dialog'
                >
                    <div class='toolbar'>
                        <div>
                            {<h1 class='dialog-title'>{props.title || ''}</h1>}
                            <Show when={props.subtitle}>
                                <h5 class='dialog-subtitle'>{props.subtitle}</h5>
                            </Show>
                        </div>
                        <div class='toolbar--right'>
                            <Show when={props.toolbar}>
                                <div class='d-flex'>{props.toolbar}</div>
                            </Show>
                            <Show when={props.toolsMenu}>
                                <MenuWrapper menu={props.toolsMenu}>
                                    <IconButton
                                        size='medium'
                                        icon={<OptionsIcon/>}
                                    />
                                </MenuWrapper>
                            </Show>
                            <Show when={!props.hideCloseButton}>
                                <IconButton
                                    class='dialog__close'
                                    onClick={props.onClose}
                                    icon={<CloseIcon/>}
                                    title={closeDialogText}
                                    size='medium'
                                />
                            </Show>
                        </div>
                    </div>
                    {props.children}
                </div>
            </div>
        </div>
    )
}

export default Dialog
