// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import {IPropertyOption} from '../blocks/board'
import {Constants} from '../constants'
import type {ComboboxOption} from '../combobox'

import Combobox, {type ComboboxContext} from './combobox'
import Menu from './menu'
import MenuWrapper from './menuWrapper'
import IconButton from './buttons/iconButton'
import OptionsIcon from './icons/options'
import DeleteIcon from './icons/delete'
import CloseIcon from './icons/close'
import Label from './label'

import './valueSelector.scss'

type Props = {
    options: IPropertyOption[]
    value?: IPropertyOption | IPropertyOption[]
    emptyValue: string
    onCreate: (value: string) => void
    onChange: (value: string | string[]) => void
    onChangeColor: (option: IPropertyOption, color: string) => void
    onDeleteOption: (option: IPropertyOption) => void
    isMulti?: boolean
    onDeleteValue?: (value: IPropertyOption) => void
    onBlur?: () => void
}

type LabelProps = {
    option: IPropertyOption
    context: ComboboxContext
    onChangeColor: (option: IPropertyOption, color: string) => void
    onDeleteOption: (option: IPropertyOption) => void
    onDeleteValue?: (value: IPropertyOption) => void
    isMulti?: boolean
}

const ValueSelectorLabel = (props: LabelProps): JSX.Element => {
    const intl = useIntl()

    const valueClassName = () => {
        let classes = props.onDeleteValue ? 'Label-no-padding' : 'Label-single-select'
        if (!props.isMulti) {
            classes += ' Label-no-margin'
        }
        return classes
    }

    return (
        <Show
            when={props.context === 'value'}
            fallback={
                <div
                    class='value-menu-option'
                    role='menuitem'
                >
                    <div class='label-container'>
                        <Label color={props.option.color}>{props.option.value}</Label>
                    </div>
                    <MenuWrapper
                        stopPropagationOnToggle={true}
                        menu={
                            <Menu position='left'>
                                <Menu.Text
                                    id='delete'
                                    icon={<DeleteIcon/>}
                                    name={intl.formatMessage({id: 'BoardComponent.delete', defaultMessage: 'Delete'})}
                                    onClick={() => props.onDeleteOption(props.option)}
                                />
                                <Menu.Separator/>
                                <For each={Object.entries(Constants.menuColors)}>
                                    {([key, color]: [string, string]) => (
                                        <Menu.Color
                                            id={key}
                                            name={color}
                                            onClick={() => props.onChangeColor(props.option, key)}
                                        />
                                    )}
                                </For>
                            </Menu>
                        }
                    >
                        <IconButton
                            title={intl.formatMessage({id: 'ValueSelectorLabel.openMenu', defaultMessage: 'Open menu'})}
                            icon={<OptionsIcon/>}
                        />
                    </MenuWrapper>
                </div>
            }
        >
            <Label
                color={props.option.color}
                class={valueClassName()}
            >
                <span class='Label-text'>{props.option.value}</span>
                <Show when={props.onDeleteValue}>
                    <IconButton
                        onClick={() => props.onDeleteValue!(props.option)}
                        icon={<CloseIcon/>}
                        title={intl.formatMessage({id: 'PropertyValueElement.clear', defaultMessage: 'Clear'})}
                        class='margin-left delete-value'
                    />
                </Show>
            </Label>
        </Show>
    )
}

function ValueSelector(props: Props): JSX.Element {
    const intl = useIntl()

    const asOption = (option: IPropertyOption): ComboboxOption<IPropertyOption> => ({
        id: option.id,
        label: option.value,
        data: option,
    })

    const chosen = (): IPropertyOption[] => {
        if (props.value) {
            return Array.isArray(props.value) ? props.value : [props.value]
        }
        return []
    }

    return (
        <Combobox
            class='ValueSelector'
            classNamePrefix='ValueSelector'
            ariaLabel={intl.formatMessage({id: 'ValueSelector.valueSelector', defaultMessage: 'Value selector'})}
            noOptionsMessage={intl.formatMessage({id: 'ValueSelector.noOptions', defaultMessage: 'No options. Start typing to add the first one!'})}
            isMulti={props.isMulti}
            isClearable={true}
            autoFocus={true}

            // A multi-select keeps its list open between choices; a single one
            // opens on the focus it takes and closes on the choice.
            menuIsOpen={props.isMulti ? true : undefined}
            options={props.options.map(asOption)}
            value={chosen().map(asOption)}
            valuesOwnTheirRemove={true}
            renderOption={(option, context) => (
                <ValueSelectorLabel
                    option={option.data}
                    context={context}
                    isMulti={props.isMulti}
                    onChangeColor={props.onChangeColor}
                    onDeleteOption={props.onDeleteOption}
                    onDeleteValue={props.onDeleteValue}
                />
            )}
            onCreate={props.onCreate}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    props.onBlur?.()
                }
            }}
            onBlur={props.onBlur}
            onChange={(value, action) => {
                if (action === 'clear') {
                    props.onChange('')
                    return
                }
                if (Array.isArray(value)) {
                    props.onChange(value.map((option) => option.id))
                } else if (value) {
                    props.onChange(value.id)
                    props.onBlur?.()
                }
            }}
        />
    )
}

export default ValueSelector
