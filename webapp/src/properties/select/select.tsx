// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {IPropertyOption} from '../../blocks/board'

import Label from '../../widgets/label'
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
