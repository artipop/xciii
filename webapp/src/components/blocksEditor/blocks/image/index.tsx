import {Show, createEffect, createSignal, onMount} from 'solid-js'

import {BlockInputProps, ContentType} from '../types'
import octoClient from '../../../../octoClient'

import './image.scss'

type FileInfo = {
    file: string|File
    width?: number
    align?: 'left'|'center'|'right'
}

const Image: ContentType<FileInfo> = {
    name: 'image',
    displayName: 'Image',
    slashCommand: '/image',
    prefix: '',
    runSlashCommand: (): void => {},
    editable: false,
    Display: (props: BlockInputProps<FileInfo>) => {
        const [imageDataUrl, setImageDataUrl] = createSignal<string|null>(null)

        createEffect(() => {
            if (!imageDataUrl() && props.value && props.value.file && typeof props.value.file === 'string') {
                octoClient.getFileAsDataUrl(props.currentBoardId || '', props.value.file).then((fileURL) => {
                    setImageDataUrl(fileURL.url || '')
                })
            }
        })

        return (
            <Show when={imageDataUrl()}>
                <img
                    data-testid='image'
                    class='ImageView'
                    src={imageDataUrl()!}
                />
            </Show>
        )
    },
    Input: (props: BlockInputProps<FileInfo>) => {
        let ref: HTMLInputElement|undefined
        onMount(() => {
            ref?.click()
        })

        return (
            <div>
                <Show when={props.value.file && (typeof props.value.file === 'string')}>
                    <img
                        class='ImageView'
                        src={props.value.file as string}
                        onClick={() => ref?.click()}
                    />
                </Show>
                <input
                    ref={ref}
                    class='Image'
                    data-testid='image-input'
                    type='file'
                    accept='image/*'
                    onChange={(e) => {
                        const file = (e.currentTarget?.files || [])[0]
                        props.onSave({file})
                    }}
                />
            </div>
        )
    },
}

Image.runSlashCommand = (changeType: (contentType: ContentType<FileInfo>) => void, changeValue: (value: FileInfo) => void): void => {
    changeType(Image)
    changeValue({file: ''})
}

export default Image
