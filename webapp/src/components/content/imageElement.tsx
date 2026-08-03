// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {IntlShape} from '../../intl'

import {ContentBlock} from '../../blocks/contentBlock'
import {ImageBlock, createImageBlock} from '../../blocks/imageBlock'
import octoClient from '../../octoClient'
import {Utils} from '../../utils'
import ImageIcon from '../../widgets/icons/image'
import {sendFlashMessage} from '../../components/flashMessages'

import {FileInfo} from '../../blocks/block'

import {contentRegistry} from './contentRegistry'
import ArchivedFile from './archivedFile/archivedFile'

type Props = {
    block: ContentBlock
}

const ImageElement = (props: Props): JSX.Element => {
    const [imageDataUrl, setImageDataUrl] = createSignal<string|null>(null)
    const [fileInfo, setFileInfo] = createSignal<FileInfo>({})

    onMount(() => {
        if (!imageDataUrl()) {
            const loadImage = async () => {
                const fileURL = await octoClient.getFileAsDataUrl(props.block.boardId, props.block.fields.fileId)
                setImageDataUrl(fileURL.url || '')
                setFileInfo(fileURL)
            }
            loadImage()
        }
    })

    return (
        <Show
            when={!fileInfo().archived}
            fallback={<ArchivedFile fileInfo={fileInfo()}/>}
        >
            <Show when={imageDataUrl()}>
                <img
                    class='ImageElement'
                    src={imageDataUrl()!}
                    alt={props.block.title}
                />
            </Show>
        </Show>
    )
}

contentRegistry.registerContentType({
    type: 'image',
    getDisplayText: (intl: IntlShape) => intl.formatMessage({id: 'ContentBlock.image', defaultMessage: 'image'}),
    getIcon: () => <ImageIcon/>,
    createBlock: async (boardId: string, intl: IntlShape) => {
        return new Promise<ImageBlock>(
            (resolve) => {
                Utils.selectLocalFile(async (file) => {
                    const fileId = await octoClient.uploadFile(boardId, file)

                    if (fileId) {
                        const block = createImageBlock()
                        block.fields.fileId = fileId || ''
                        resolve(block)
                    } else {
                        sendFlashMessage({content: intl.formatMessage({id: 'createImageBlock.failed', defaultMessage: 'Unable to upload the file. File size limit reached.'}), severity: 'normal'})
                    }
                },
                '.jpg,.jpeg,.png,.gif')
            },
        )
    },
    createComponent: (block) => <ImageElement block={block}/>,
})

export default ImageElement
