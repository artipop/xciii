// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onCleanup, onMount} from 'solid-js'
import type {ParentComponent} from 'solid-js'

import {useIntl} from '../intl'
import IconButton from '../widgets/buttons/iconButton'
import CloseIcon from '../widgets/icons/close'
import './modal.scss'

type Props = {
    onClose: () => void
    position?: 'top'|'bottom'|'bottom-right'
}

const Modal: ParentComponent<Props> = (props) => {
    const intl = useIntl()
    let node: HTMLDivElement | undefined

    const closeOnBlur = (e: Event) => {
        if (e.target && node?.contains(e.target as Node)) {
            return
        }
        props.onClose()
    }

    onMount(() => {
        document.addEventListener('click', closeOnBlur, true)
        onCleanup(() => {
            document.removeEventListener('click', closeOnBlur, true)
        })
    })

    return (
        <div
            class={'Modal ' + (props.position || 'bottom')}
            ref={node}
        >
            <div class='toolbar hideOnWidescreen'>
                <IconButton
                    onClick={() => props.onClose()}
                    icon={<CloseIcon/>}
                    title={intl.formatMessage({id: 'Modal.close', defaultMessage: 'Close'})}
                />
            </div>
            {props.children}
        </div>
    )
}

export default Modal
