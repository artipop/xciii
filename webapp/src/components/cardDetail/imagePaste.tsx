import {onCleanup, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {ImageBlock, createImageBlock} from '../../blocks/imageBlock'
import {sendFlashMessage} from '../flashMessages'
import {Block} from '../../blocks/block'
import octoClient from '../../octoClient'
import mutator from '../../mutator'

// The ids and the content order arrive as accessors so a paste always lands on
// the card as it is now, not as it was when the hook mounted.
export default function useImagePaste(boardId: () => string, cardId: () => string, contentOrder: () => Array<string | string[]>): void {
    const intl = useIntl()
    const uploadItems = async (items: FileList) => {
        let newImage: File|null = null
        const uploads: Array<Promise<string|undefined>> = []

        if (!items.length) {
            return
        }

        for (const item of items) {
            newImage = item
            if (newImage?.type.indexOf('image/') === 0) {
                uploads.push(octoClient.uploadFile(boardId(), newImage))
            }
        }

        const uploaded = await Promise.all(uploads)
        const blocksToInsert: ImageBlock[] = []
        let someFilesNotUploaded = false
        for (const fileId of uploaded) {
            if (!fileId) {
                someFilesNotUploaded = true
                continue
            }
            const block = createImageBlock()
            block.parentId = cardId()
            block.boardId = boardId()
            block.fields.fileId = fileId || ''
            blocksToInsert.push(block)
        }

        if (someFilesNotUploaded) {
            sendFlashMessage({content: intl.formatMessage({id: 'imagePaste.upload-failed', defaultMessage: 'Some files not uploaded. File size limit reached'}), severity: 'normal'})
        }

        const afterRedo = async (newBlocks: Block[]) => {
            const newContentOrder = JSON.parse(JSON.stringify(contentOrder()))
            newContentOrder.push(...newBlocks.map((b: Block) => b.id))
            await octoClient.patchBlock(boardId(), cardId(), {updatedFields: {contentOrder: newContentOrder}})
        }

        const beforeUndo = async () => {
            const newContentOrder = JSON.parse(JSON.stringify(contentOrder()))
            await octoClient.patchBlock(boardId(), cardId(), {updatedFields: {contentOrder: newContentOrder}})
        }

        await mutator.insertBlocks(boardId(), blocksToInsert, 'pasted images', afterRedo, beforeUndo)
    }

    const onDrop = (event: DragEvent): void => {
        if (event.dataTransfer) {
            const items = event.dataTransfer.files
            uploadItems(items)
        }
    }

    const onPaste = (event: ClipboardEvent): void => {
        if (event.clipboardData) {
            const items = event.clipboardData.files
            uploadItems(items)
        }
    }

    onMount(() => {
        document.addEventListener('paste', onPaste)
        document.addEventListener('drop', onDrop)
        onCleanup(() => {
            document.removeEventListener('paste', onPaste)
            document.removeEventListener('drop', onDrop)
        })
    })
}
