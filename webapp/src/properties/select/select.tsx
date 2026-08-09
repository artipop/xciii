// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {IPropertyOption} from '../../blocks/board'

import Label from '../../widgets/label'
import IconButton from '../../widgets/buttons/iconButton'
import CloseIcon from '../../widgets/icons/close'
import {Utils, IDType} from '../../utils'
import mutator from '../../mutator'
import ValueSelector from '../../widgets/valueSelector'

import {PropertyProps} from '../types'

const SelectProperty = (props: PropertyProps) => {
    const intl = useIntl()

    const [open, setOpen] = createSignal(false)
    const isEditable = () => !props.readOnly && Boolean(props.board)

    const onCreate = (newValue: string) => {
        const option: IPropertyOption = {
            id: Utils.createGuid(IDType.BlockID),
            value: newValue,
            color: 'propColorDefault',
        }
        mutator.insertPropertyOption(props.board.id, props.board.cardProperties, props.propertyTemplate, option, 'add property option').then(() => {
            mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, option.id)
        })
    }

    const emptyDisplayValue = () => (props.showEmptyPlaceholder ? intl.formatMessage({id: 'PropertyValueElement.empty', defaultMessage: 'Empty'}) : '')

    const onChange = (newValue: string | string[]) => mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newValue)
    const onChangeColor = (option: IPropertyOption, colorId: string) => mutator.changePropertyOptionColor(props.board.id, props.board.cardProperties, props.propertyTemplate, option, colorId)
    const onDeleteOption = (option: IPropertyOption) => mutator.deletePropertyOption(props.board.id, props.board.cardProperties, props.propertyTemplate, option)
    const onDeleteValue = () => mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, '')

    const option = () => props.propertyTemplate.options.find((o: IPropertyOption) => o.id === props.propertyValue)
    const displayValue = () => option()?.value
    const finalDisplayValue = () => displayValue() || emptyDisplayValue()

    // The card's own property list shows what is chosen as something that can
    // be taken off, the way it shows the people a card is assigned to. Anywhere
    // else — a cell in a table, a badge on a kanban card — the value is being
    // read and a row of crosses is noise; `showEmptyPlaceholder` is what tells
    // the two apart, and it is set on the card and nowhere else.
    //
    // Without this, clearing meant opening the selector and finding the cross
    // inside it. The only thing that looked like a way out was «Удалить» in the
    // option's own menu, which deletes the option from the whole board.
    const clearable = () => isEditable() && props.showEmptyPlaceholder && Boolean(option())

    return (
        <Show
            when={isEditable() && open()}
            fallback={
                <div
                    class={props.property.valueClassName(!isEditable())}
                    data-testid='select-non-editable'
                    tabIndex={0}
                    onClick={() => setOpen(true)}
                >
                    <Label color={displayValue() ? (option()?.color || '') : 'empty'}>
                        <span class='Label-text'>{finalDisplayValue()}</span>
                        <Show when={clearable()}>
                            <IconButton
                                icon={<CloseIcon/>}
                                title={intl.formatMessage({id: 'PropertyValueElement.clear', defaultMessage: 'Clear'})}
                                class='margin-left delete-value'
                                onClick={(e) => {
                                    // The chip itself opens the selector.
                                    e.stopPropagation()
                                    onDeleteValue()
                                }}
                            />
                        </Show>
                    </Label>
                </div>
            }
        >
            <ValueSelector
                emptyValue={emptyDisplayValue()}
                options={props.propertyTemplate.options}
                value={props.propertyTemplate.options.find((p: IPropertyOption) => p.id === props.propertyValue)}
                onCreate={onCreate}
                onChange={onChange}
                onChangeColor={onChangeColor}
                onDeleteOption={onDeleteOption}
                onDeleteValue={onDeleteValue}
                onBlur={() => setOpen(false)}
            />
        </Show>
    )
}

export default SelectProperty
