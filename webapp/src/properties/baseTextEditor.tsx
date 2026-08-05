// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import mutator from '../mutator'
import Editable from '../widgets/editable'

import {PropertyProps} from './types'

const BaseTextEditor = (props: PropertyProps & {validator: () => boolean, spellCheck?: boolean}): JSX.Element => {
    const [value, setValue] = createSignal(props.card.fields.properties[props.propertyTemplate.id || ''] || '')
    const onCancel = () => setValue(props.propertyValue || '')

    const saveTextProperty = () => {
        if (value() !== (props.card.fields.properties[props.propertyTemplate?.id || ''] || '')) {
            mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate?.id || '', value())
        }
    }

    const saveIfEditable = () => {
        if (!props.readOnly) {
            saveTextProperty()
        }
    }

    const intl = useIntl()
    const emptyDisplayValue = () => (props.showEmptyPlaceholder ? intl.formatMessage({id: 'PropertyValueElement.empty', defaultMessage: 'Empty'}) : '')

    // The React version flushed an unsaved value on unmount.
    onCleanup(saveIfEditable)

    return (
        <Show
            when={!props.readOnly}
            fallback={<div class={props.property.valueClassName(true)}>{props.propertyValue}</div>}
        >
            <Editable
                class={props.property.valueClassName(props.readOnly)}
                placeholderText={emptyDisplayValue()}
                value={value().toString()}
                autoExpand={true}
                onChange={setValue}
                onSave={saveTextProperty}
                onCancel={onCancel}
                validator={props.validator}
                spellCheck={props.spellCheck}
            />
        </Show>
    )
}

export default BaseTextEditor
