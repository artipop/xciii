import {For} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import AttachmentElement from '../../components/content/attachmentElement'
import {AttachmentBlock} from '../../blocks/attachmentBlock'

import './attachment.scss'
import {Block} from '../../blocks/block'
import CompassIcon from '../../widgets/icons/compassIcon'
import BoardPermissionGate from '../../components/permissions/boardPermissionGate'
import {Permission} from '../../constants'

type Props = {
    attachments: AttachmentBlock[]
    onDelete: (block: Block) => void
    addAttachment: () => void
}

const AttachmentList = (props: Props): JSX.Element => {
    const intl = useIntl()

    return (
        <div class='Attachment'>
            <div class='attachment-header'>
                <div class='attachment-title mb-2'>{intl.formatMessage({id: 'Attachment.Attachment-title', defaultMessage: 'Attachment'})} {`(${props.attachments.length})`}</div>
                <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                    <div
                        class='attachment-plus-btn'
                        onClick={props.addAttachment}
                    >
                        <CompassIcon
                            icon='plus'
                            class='attachment-plus-icon'
                        />
                    </div>
                </BoardPermissionGate>
            </div>
            <div class='attachment-content'>
                <For each={props.attachments}>
                    {(block: AttachmentBlock) => (
                        <div>
                            <AttachmentElement
                                block={block}
                                onDelete={props.onDelete}
                            />
                        </div>
                    )}
                </For>
            </div>
        </div>
    )
}

export default AttachmentList
