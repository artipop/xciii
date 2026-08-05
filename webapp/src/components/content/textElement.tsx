// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import cx from 'classnames'

import {useIntl} from '../../intl'

import {ContentBlock} from '../../blocks/contentBlock'
import {createTextBlock} from '../../blocks/textBlock'
import mutator from '../../mutator'
import TextIcon from '../../widgets/icons/text'
import {MarkdownEditor} from '../markdownEditor'

import {contentRegistry} from './contentRegistry'

import './textElement.scss'

type Props = {
    block: ContentBlock
    readonly: boolean
}

const BlockTitleMaxBytes = 65535 // Maximum size of a TEXT column in MySQL
const BlockTitleMaxRunes = BlockTitleMaxBytes / 4 // Assume a worst-case representation

const TextElement = (props: Props): JSX.Element => {
    const intl = useIntl()

    const [isError, setIsError] = createSignal<boolean>(false)
    const [blockTitle, setBlockTitle] = createSignal(props.block.title)

    const textChangedHandler = (text: string): void => {
        setBlockTitle(text)
        const textSize = text.length
        setIsError(textSize > BlockTitleMaxRunes)
    }

    const handleBlur = (text: string): void => {
        if (text !== props.block.title || blockTitle() !== props.block.title) {
            const textSize = new Blob([text]).size
            if (textSize <= BlockTitleMaxRunes) {
                mutator.changeBlockTitle(props.block.boardId, props.block.id, props.block.title, text, intl.formatMessage({id: 'ContentBlock.editCardText', defaultMessage: 'edit card text'})).
                    finally(() => {
                        setIsError(false)
                    })
            }
        }
    }

    return (
        <div class='TextElement'>
            <MarkdownEditor
                class={cx({'markdown-editor-error': isError()})}
                text={blockTitle()}
                placeholderText={intl.formatMessage({id: 'ContentBlock.editText', defaultMessage: 'Edit text...'})}
                onChange={textChangedHandler}
                onBlur={handleBlur}
                readonly={props.readonly}
            />
            <Show when={isError()}>
                <div class='error-message'>{intl.formatMessage({id: 'ContentBlock.errorText', defaultMessage: 'You\'ve exceeded the size limit for this content. Please shorten it to avoid losing data.'})}</div>
            </Show>
        </div>
    )
}

contentRegistry.registerContentType({
    type: 'text',
    getDisplayText: (intl) => intl.formatMessage({id: 'ContentBlock.text', defaultMessage: 'text'}),
    getIcon: () => <TextIcon/>,
    createBlock: async () => {
        return createTextBlock()
    },
    createComponent: (block, readonly) => {
        return (
            <TextElement
                block={block}
                readonly={readonly}
            />
        )
    },
})

export default TextElement
