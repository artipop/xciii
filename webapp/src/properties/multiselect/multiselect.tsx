// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {IPropertyOption} from '../../blocks/board'
import {Utils, IDType} from '../../utils'

import mutator from '../../mutator'

import Label from '../../widgets/label'
import ValueSelector from '../../widgets/valueSelector'

import {PropertyProps} from '../types'

const MultiSelectProperty = (props: PropertyProps): JSX.Element => {
    const isEditable = () => !props.readOnly && Boolean(props.board)
    const [open, setOpen] = createSignal(false)
    const intl = useIntl()

    const emptyDisplayValue = () => (props.showEmptyPlaceholder ? intl.formatMessage({id: 'PropertyValueElement.empty', defaultMessage: 'Empty'}) : '')

    const onChange = (newValue: string | string[]) => mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newValue)
    const onChangeColor = (option: IPropertyOption, colorId: string) => mutator.changePropertyOptionColor(props.board.id, props.board.cardProperties, props.propertyTemplate, option, colorId)
    const onDeleteOption = (option: IPropertyOption) => mutator.deletePropertyOption(props.board.id, props.board.cardProperties, props.propertyTemplate, option)

    const onDeleteValue = (valueToDelete: IPropertyOption, currentValues: IPropertyOption[]) => {
        const newValues = currentValues.
            filter((currentValue) => currentValue.id !== valueToDelete.id).
            map((currentValue) => currentValue.id)
        mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newValues)
    }

    const onCreateValue = (newValue: string, currentValues: IPropertyOption[]) => {
        const option: IPropertyOption = {
            id: Utils.createGuid(IDType.BlockID),
            value: newValue,
            color: 'propColorDefault',
        }
        currentValues.push(option)
        mutator.insertPropertyOption(props.board.id, props.board.cardProperties, props.propertyTemplate, option, 'add property option').then(() => {
            mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, currentValues.map((v: IPropertyOption) => v.id))
        })
    }

    const values = () => (Array.isArray(props.propertyValue) && props.propertyValue.length > 0 ? props.propertyValue.map((v) => props.propertyTemplate.options.find((o) => o!.id === v)).filter((v): v is IPropertyOption => Boolean(v)) : [])

    return (
        <Show
            when={isEditable() && open()}
            fallback={
                <div
                    class={props.property.valueClassName(!isEditable())}
                    tabIndex={0}
                    data-testid='multiselect-non-editable'
                    onClick={() => setOpen(true)}
                >
                    <For each={values()}>
                        {(v) => (
                            <Label color={v.color}>
                                {v.value}
                            </Label>
                        )}
                    </For>
                    <Show when={values().length === 0}>
                        <Label color='empty'>{emptyDisplayValue()}</Label>
                    </Show>
                </div>
            }
        >
            <ValueSelector
                isMulti={true}
                emptyValue={emptyDisplayValue()}
                options={props.propertyTemplate.options}
                value={values()}
                onChange={onChange}
                onChangeColor={onChangeColor}
                onDeleteOption={onDeleteOption}
                onDeleteValue={(valueToRemove) => onDeleteValue(valueToRemove, values())}
                onCreate={(newValue) => onCreateValue(newValue, values())}
                onBlur={() => setOpen(false)}
            />
        </Show>
    )
}

export default MultiSelectProperty
