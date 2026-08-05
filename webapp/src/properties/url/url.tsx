// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import Editable, {Focusable} from '../../widgets/editable'

import {Utils} from '../../utils'
import mutator from '../../mutator'
import EditIcon from '../../widgets/icons/edit'
import IconButton from '../../widgets/buttons/iconButton'
import DuplicateIcon from '../../widgets/icons/duplicate'
import {sendFlashMessage} from '../../components/flashMessages'

import {PropertyProps} from '../types'

import './url.scss'

const URLProperty = (props: PropertyProps): JSX.Element => {
    const [value, setValue] = createSignal(props.card.fields.properties[props.propertyTemplate.id || ''] || '')
    const [isEditing, setIsEditing] = createSignal(false)
    const isEmpty = () => !(props.propertyValue as string)?.trim()
    const showEditable = () => !props.readOnly && (isEditing() || isEmpty())
    let editableRef: Focusable | undefined
    const intl = useIntl()

    const emptyDisplayValue = () => (props.showEmptyPlaceholder ? intl.formatMessage({id: 'PropertyValueElement.empty', defaultMessage: 'Empty'}) : '')

    const saveTextProperty = () => {
        // See baseTextEditor: this also runs from onCleanup, by which time the
        // card may be gone, and throwing inside disposal wedges the dialog open.
        const card = props.card
        if (!card) {
            return
        }
        if (value() !== (card.fields.properties[props.propertyTemplate?.id || ''] || '')) {
            mutator.changePropertyValue(props.board.id, card, props.propertyTemplate?.id || '', value())
        }
    }

    // The React version flushed an unsaved value on unmount.
    onCleanup(() => {
        if (!props.readOnly) {
            saveTextProperty()
        }
    })

    createEffect(() => {
        if (isEditing()) {
            editableRef?.focus()
        }
    })

    return (
        <Show when={props.propertyTemplate}>
            <Show
                when={showEditable()}
                fallback={
                    <div class={`URLProperty ${props.property.valueClassName(props.readOnly)}`}>
                        <a
                            class='link'
                            href={Utils.ensureProtocol(((props.propertyValue as string) || '').trim())}
                            target='_blank'
                            rel='noreferrer'
                            onClick={(event) => event.stopPropagation()}
                        >
                            {props.propertyValue}
                        </a>
                        <Show when={!props.readOnly}>
                            <IconButton
                                class='Button_Edit'
                                title={intl.formatMessage({id: 'URLProperty.edit', defaultMessage: 'Edit'})}
                                icon={<EditIcon/>}
                                onClick={() => setIsEditing(true)}
                            />
                        </Show>
                        <IconButton
                            class='Button_Copy'
                            title={intl.formatMessage({id: 'URLProperty.copy', defaultMessage: 'Copy'})}
                            icon={<DuplicateIcon/>}
                            onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                Utils.copyTextToClipboard(props.propertyValue as string)
                                sendFlashMessage({content: intl.formatMessage({id: 'URLProperty.copiedLink', defaultMessage: 'Copied!'}), severity: 'high'})
                            }}
                        />
                    </div>
                }
            >
                <div class='URLProperty'>
                    <Editable
                        class={props.property.valueClassName(props.readOnly)}
                        ref={(f) => {
                            editableRef = f
                        }}
                        placeholderText={emptyDisplayValue()}
                        value={value() as string}
                        autoExpand={true}
                        readonly={props.readOnly}
                        onChange={setValue}
                        onSave={() => {
                            setIsEditing(false)
                            saveTextProperty()
                        }}
                        onCancel={() => {
                            setIsEditing(false)
                            setValue(props.propertyValue || '')
                        }}
                        onFocus={() => {
                            setIsEditing(true)
                        }}
                        validator={() => {
                            if (value() === '') {
                                return true
                            }
                            const urlRegexp = /(((.+:(?:\/\/)?)?(?:[-;:&=+$,\w]+@)?[A-Za-z0-9.-]+|(?:www\.|[-;:&=+$,\w]+@)[A-Za-z0-9.-]+)((?:\/[+~%/.\w\-_]*)?\??(?:[-+=&;%@.\w_]*)#?(?:[.!/\\\w]*))?)/
                            return urlRegexp.test(value() as string)
                        }}
                    />
                </div>
            </Show>
        </Show>
    )
}

export default URLProperty
