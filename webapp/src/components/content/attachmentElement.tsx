import {Show, createEffect, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import octoClient from '../../octoClient'

import {AttachmentBlock} from '../../blocks/attachmentBlock'
import {Block, FileInfo} from '../../blocks/block'
import Files from '../../file'
import FileIcons from '../../fileIcons'

import BoardPermissionGate from '../../components/permissions/boardPermissionGate'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../../components/confirmationDialogBox'
import {Utils} from '../../utils'
import {getUploadPercent} from '../../store/attachments'
import {useAppSelector} from '../../store/hooks'
import {Permission} from '../../constants'

import ArchivedFile from './archivedFile/archivedFile'

import './attachmentElement.scss'
import CompassIcon from './../../widgets/icons/compassIcon'
import MenuWrapper from './../../widgets/menuWrapper'
import IconButton from './../../widgets/buttons/iconButton'
import Menu from './../../widgets/menu'
import Tooltip from './../../widgets/tooltip'

type Props = {
    block: AttachmentBlock
    onDelete?: (block: Block) => void
}

const AttachmentElement = (props: Props): JSX.Element => {
    const [fileInfo, setFileInfo] = createSignal<FileInfo>({})
    const [fileSize, setFileSize] = createSignal<string>()
    const [fileIcon, setFileIcon] = createSignal<string>('file-text-outline-larg')
    const [fileName, setFileName] = createSignal<string>()
    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)
    const uploadPercent = useAppSelector((state) => getUploadPercent(props.block.id)(state))
    const intl = useIntl()

    onMount(() => {
        const loadFile = async () => {
            if (props.block.isUploading) {
                setFileInfo({
                    name: props.block.title,
                    extension: props.block.title.split('.').slice(0, -1).join('.'),
                })
                return
            }
            const attachmentInfo = await octoClient.getFileInfo(props.block.boardId, props.block.fields.fileId)
            setFileInfo(attachmentInfo)
        }
        loadFile()
    })

    createEffect(() => {
        if (fileInfo().size && !fileSize()) {
            setFileSize(Utils.humanFileSize(fileInfo().size!))
        }
        if (fileInfo().name && !fileName()) {
            const generateFileName = (fName: string) => {
                if (fName.length > 18) {
                    let result = fName.slice(0, 15)
                    result += '...'
                    return result
                }
                return fName
            }
            setFileName(generateFileName(fileInfo().name!))
        }
    })

    createEffect(() => {
        const extension = fileInfo().extension
        if (extension) {
            const getFileIcon = (fileExt: string) => {
                const extType = (Object.keys(Files) as string[]).find((key) => Files[key].find((ext) => ext === fileExt))
                if (extType) {
                    setFileIcon(FileIcons[extType])
                } else {
                    setFileIcon('file-generic-outline-large')
                }
            }
            getFileIcon(extension.substring(1))
        }
    })

    const deleteAttachment = () => {
        if (props.onDelete) {
            props.onDelete(props.block)
        }
    }

    const confirmDialogProps: ConfirmationDialogBoxProps = {
        heading: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-attachment', defaultMessage: 'Confirm Attachment delete!'}),
        confirmButtonText: intl.formatMessage({id: 'AttachmentElement.delete-confirmation-dialog-button-text', defaultMessage: 'Delete'}),
        onConfirm: deleteAttachment,
        onClose: () => {
            setShowConfirmationDialogBox(false)
        },
    }

    const handleDeleteButtonClick = () => {
        setShowConfirmationDialogBox(true)
    }

    const attachmentDownloadHandler = async () => {
        const attachment = await octoClient.getFileAsDataUrl(props.block.boardId, props.block.fields.fileId)
        const anchor = document.createElement('a')
        anchor.href = attachment.url || ''
        anchor.download = fileInfo().name || ''
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
    }

    return (
        <Show
            when={!fileInfo().archived}
            fallback={<ArchivedFile fileInfo={fileInfo()}/>}
        >
            <div class='FileElement mr-4'>
                <Show when={showConfirmationDialogBox()}>
                    <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
                </Show>
                <div class='fileElement-icon-division'>
                    <CompassIcon
                        icon={fileIcon()}
                        class='fileElement-icon'
                    />
                </div>
                <div class='fileElement-file-details mt-3'>
                    <Tooltip
                        title={fileInfo().name ? fileInfo().name! : ''}
                        placement='bottom'
                    >
                        <div class='fileElement-file-name'>
                            {fileName()}
                        </div>
                    </Tooltip>
                    <Show
                        when={props.block.isUploading}
                        fallback={
                            <div class='fileElement-file-ext-and-size'>
                                {fileInfo().extension?.substring(1)} {fileSize()}
                            </div>
                        }
                    >
                        <div class='fileElement-file-uploading'>
                            {intl.formatMessage({
                                id: 'AttachmentElement.upload-percentage',
                                defaultMessage: 'Uploading...({uploadPercent}%)',
                            }, {
                                uploadPercent: uploadPercent(),
                            })}
                        </div>
                    </Show>
                </div>
                <Show when={props.block.isUploading}>
                    <div class='progress'>
                        <span
                            class='progress-bar'
                            style={{width: uploadPercent() + '%'}}
                        >
                            {''}
                        </span>
                    </div>
                </Show>
                <Show when={!props.block.isUploading}>
                    <div class='fileElement-delete-download'>
                        <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                            <MenuWrapper
                                class='mt-3 fileElement-menu-icon'
                                menu={
                                    <div class='delete-menu'>
                                        <Menu position='left'>
                                            <Menu.Text
                                                id='makeTemplate'
                                                icon={
                                                    <CompassIcon
                                                        icon='trash-can-outline'
                                                    />}
                                                name='Delete'
                                                onClick={handleDeleteButtonClick}
                                            />
                                        </Menu>
                                    </div>
                                }
                            >
                                <IconButton
                                    size='medium'
                                    icon={<CompassIcon icon='dots-vertical'/>}
                                />
                            </MenuWrapper>
                        </BoardPermissionGate>
                        <Tooltip
                            title={intl.formatMessage({id: 'AttachmentElement.download', defaultMessage: 'Download'})}
                            placement='bottom'
                        >
                            <div
                                class='fileElement-download-btn mt-3 mr-2'
                                onClick={attachmentDownloadHandler}
                            >
                                <CompassIcon
                                    icon='download-outline'
                                />
                            </div>
                        </Tooltip>
                    </div>
                </Show>
            </div>
        </Show>
    )
}

export default AttachmentElement
