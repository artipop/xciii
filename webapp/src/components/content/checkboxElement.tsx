// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {createCheckboxBlock} from '../../blocks/checkboxBlock'
import {ContentBlock} from '../../blocks/contentBlock'
import CheckIcon from '../../widgets/icons/check'
import mutator from '../../mutator'
import Editable, {Focusable} from '../../widgets/editable'
import {useCardDetailContext} from '../cardDetail/cardDetailContext'

import './checkboxElement.scss'

import {contentRegistry} from './contentRegistry'

type Props = {
    block: ContentBlock
    readonly: boolean
    onAddElement?: () => void
    onDeleteElement?: () => void
}

const CheckboxElement = (props: Props) => {
    const intl = useIntl()
    let titleRef: Focusable | undefined
    const cardDetail = useCardDetailContext()
    const [addedBlockId, setAddedBlockId] = createSignal(cardDetail.lastAddedBlock.id)
    const [active, setActive] = createSignal(Boolean(props.block.fields.value))
    const [title, setTitle] = createSignal(props.block.title)

    createEffect(() => {
        if (props.block.id === addedBlockId()) {
            titleRef?.focus()
            setAddedBlockId('')
        }
    })

    createEffect(() => {
        setActive(Boolean(props.block.fields.value))
    })

    return (
        <div class='CheckboxElement'>
            <input
                type='checkbox'
                id={`checkbox-${props.block.id}`}
                disabled={props.readonly}
                checked={active()}
                value={active() ? 'on' : 'off'}
                onChange={(e) => {
                    e.preventDefault()
                    const newBlock = createCheckboxBlock(props.block)
                    newBlock.fields.value = !active()
                    newBlock.title = title()
                    setActive(newBlock.fields.value)
                    mutator.updateBlock(props.block.boardId, newBlock, props.block, intl.formatMessage({id: 'ContentBlock.editCardCheckbox', defaultMessage: 'toggled-checkbox'}))
                }}
            />
            <Editable
                ref={(f) => {
                    titleRef = f
                }}
                value={title()}
                placeholderText={intl.formatMessage({id: 'ContentBlock.editText', defaultMessage: 'Edit text...'})}
                onChange={setTitle}
                saveOnEsc={true}
                onSave={async (saveType) => {
                    // The title as it was at save time: the signal keeps
                    // moving while the mutation is awaited, and the React
                    // version's closure never saw those later keystrokes.
                    const savedTitle = title()
                    const {lastAddedBlock} = cardDetail
                    if (savedTitle === '' && props.block.id === lastAddedBlock.id && lastAddedBlock.autoAdded && props.onDeleteElement) {
                        props.onDeleteElement()
                        return
                    }

                    if (props.block.title !== savedTitle) {
                        await mutator.changeBlockTitle(props.block.boardId, props.block.id, props.block.title, savedTitle, intl.formatMessage({id: 'ContentBlock.editCardCheckboxText', defaultMessage: 'edit card text'}))
                        if (saveType === 'onEnter' && savedTitle !== '' && props.onAddElement) {
                            // Wait for the change to happen
                            setTimeout(props.onAddElement, 100)
                        }
                        return
                    }

                    if (saveType === 'onEnter' && savedTitle !== '' && props.onAddElement) {
                        props.onAddElement()
                    }
                }}
                readonly={props.readonly}
                spellCheck={true}
            />
        </div>
    )
}

contentRegistry.registerContentType({
    type: 'checkbox',
    getDisplayText: (intl) => intl.formatMessage({id: 'ContentBlock.checkbox', defaultMessage: 'checkbox'}),
    getIcon: () => <CheckIcon/>,
    createBlock: async () => {
        return createCheckboxBlock()
    },
    createComponent: (block, readonly, onAddElement, onDeleteElement) => {
        return (
            <CheckboxElement
                block={block}
                readonly={readonly}
                onAddElement={onAddElement}
                onDeleteElement={onDeleteElement}
            />
        )
    },
})

export default CheckboxElement
