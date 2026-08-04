// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, createSignal, onMount} from 'solid-js'

import {BlockInputProps, ContentType} from '../types'
import octoClient from '../../../../octoClient'

import './attachment.scss'

type FileInfo = {
    file: string|File
    filename: string
}

const Attachment: ContentType<FileInfo> = {
    name: 'attachment',
    displayName: 'Attachment',
    slashCommand: '/attachment',
    prefix: '',
    runSlashCommand: (): void => {},
    editable: false,
    Display: (props: BlockInputProps<FileInfo>) => {
        const [fileDataUrl, setFileDataUrl] = createSignal<string|null>(null)

        createEffect(() => {
            if (!fileDataUrl() && props.value && props.value.file && typeof props.value.file === 'string') {
                octoClient.getFileAsDataUrl(props.currentBoardId || '', props.value.file).then((fileURL) => {
                    setFileDataUrl(fileURL.url || '')
                })
            }
        })

        return (
            <div
                class='AttachmentView'
                data-testid='attachment'
            >
                <a
                    href={fileDataUrl() || '#'}
                    onClick={(e) => e.stopPropagation()}
                    download={props.value.filename}
                >
                    {'📎'} {props.value.filename}
                </a>
            </div>
        )
    },
    Input: (props: BlockInputProps<FileInfo>) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.click()
        })

        return (
            <input
                ref={ref}
                class='Attachment'
                data-testid='attachment-input'
                type='file'
                onChange={(e) => {
                    const files = e.currentTarget?.files
                    if (files) {
                        for (let i = 0; i < files.length; i++) {
                            const file = files.item(i)
                            if (file) {
                                props.onSave({file, filename: file.name})
                            }
                        }
                    }
                }}
            />
        )
    },
}

Attachment.runSlashCommand = (changeType: (contentType: ContentType<FileInfo>) => void, changeValue: (value: FileInfo) => void): void => {
    changeType(Attachment)
    changeValue({} as any)
}

export default Attachment
