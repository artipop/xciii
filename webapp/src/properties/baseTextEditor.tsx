import {Show, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import mutator from '../mutator'
import Editable from '../widgets/editable'

import {PropertyProps} from './types'

const BaseTextEditor = (props: PropertyProps & {validator: () => boolean, spellCheck?: boolean}): JSX.Element => {
    const [value, setValue] = createSignal(props.card.fields.properties[props.propertyTemplate.id || ''] || '')
    const onCancel = () => setValue(props.propertyValue || '')

    // The card this value was read from. The card dialog is reused when you
    // switch cards, so without this the pending value would be flushed onto
    // whichever card is open when the editor is finally disposed.
    const editedCardId = props.card.id

    const saveTextProperty = () => {
        // The card can already be gone: this also runs from onCleanup, and
        // closing a card disposes the dialog in the same tick the store stops
        // knowing about the card. Reading `.fields` off nothing threw from
        // inside disposal, which aborts it — so the dialog never came off the
        // screen and the card could not be closed at all.
        const card = props.card
        if (!card || card.id !== editedCardId) {
            return
        }
        if (value() !== (card.fields.properties[props.propertyTemplate?.id || ''] || '')) {
            mutator.changePropertyValue(props.board.id, card, props.propertyTemplate?.id || '', value())
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

                // Stretching the input to its container is what a table cell
                // wants — the column is the width of the answer there. On a
                // card it made «Оценка, часы» a 440px box tinting on hover
                // across the whole row, beside every other answer's 180. Which
                // of the two this is is `showEmptyPlaceholder`, set on the card
                // and nowhere else (the same reading select.tsx makes).
                autoExpand={!props.showEmptyPlaceholder}
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
