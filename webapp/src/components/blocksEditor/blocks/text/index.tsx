import {MarkdownEditor} from '../../../markdownEditor'
import {Utils} from '../../../../utils'

import {BlockInputProps, ContentType} from '../types'

import './text.scss'

const TextContent: ContentType = {
    name: 'text',
    displayName: 'Text',
    slashCommand: '/text',
    prefix: '',
    runSlashCommand: (): void => {},
    editable: true,
    Display: (props: BlockInputProps) => {
        return (
            <div
                innerHTML={Utils.htmlFromMarkdown(props.value || '')}
                class={props.value ? 'octo-editor-preview' : 'octo-editor-preview octo-placeholder'}
            />
        )
    },
    Input: (props: BlockInputProps) => {
        return (
            <div
                class='TextContent'
                data-testid='text'
            >
                <MarkdownEditor
                    autofocus={true}
                    onBlur={(val: string) => {
                        props.onSave(val)
                    }}
                    text={props.value}
                    saveOnEnter={true}
                    onEditorCancel={() => {
                        props.onCancel()
                    }}
                />
            </div>
        )
    },
}

TextContent.runSlashCommand = (changeType: (contentType: ContentType) => void, changeValue: (value: string) => void, ...args: string[]): void => {
    changeType(TextContent)
    changeValue(args.join(' '))
}

export default TextContent
