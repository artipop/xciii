// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {Option as SelectOption, typesByOptions} from '../../calculations/options'
import {IPropertyTemplate} from '../../../blocks/board'
import ChevronRight from '../../../widgets/icons/chevronRight'
import {Constants} from '../../../constants'

type OptionProps = SelectOption & {
    cardProperties: IPropertyTemplate[]
    onChange: (data: {calculation: string, propertyId: string}) => void
    activeValue: string
    activeProperty: IPropertyTemplate
}

const Option = (props: {data: OptionProps}): JSX.Element => {
    const [submenu, setSubmenu] = createSignal(false)
    const [height, setHeight] = createSignal(0)
    const [menuOptionRight, setMenuOptionRight] = createSignal(0)
    const calculationToProperties = new Map<string, IPropertyTemplate[]>()

    const toggleOption = (e: MouseEvent) => {
        if (submenu()) {
            setSubmenu(false)
        } else {
            const rect = (e.target as HTMLElement).getBoundingClientRect()
            setHeight(rect.y)
            setMenuOptionRight(rect.x + rect.width)
            setSubmenu(true)
        }
    }

    const supportedProperties = (): IPropertyTemplate[] => {
        if (!calculationToProperties.get(props.data.value)) {
            const supportedPropertyTypes = new Map<string, boolean>([])
            if (typesByOptions.get(props.data.value)) {
                (typesByOptions.get(props.data.value) || []).
                    forEach((propertyType) => supportedPropertyTypes.set(propertyType, true))
            }

            calculationToProperties.set(props.data.value, props.data.cardProperties.
                filter((property) => supportedPropertyTypes.get(property.type) || supportedPropertyTypes.get('common')))
        }
        return calculationToProperties.get(props.data.value) || []
    }

    return (
        <div
            class={`KanbanCalculationOptions_CustomOption ${props.data.activeValue === props.data.value ? 'active' : ''}`}
            onMouseEnter={toggleOption}
            onMouseLeave={toggleOption}
            onClick={() => {
                if (props.data.value !== 'count') {
                    return
                }

                props.data.onChange({
                    calculation: 'count',
                    propertyId: Constants.titleColumnId,
                })
            }}
        >
            <span>
                {props.data.label} <Show when={props.data.value !== 'count'}><ChevronRight/></Show>
            </span>

            <Show when={submenu() && props.data.value !== 'count'}>
                <div
                    class='dropdown-submenu'
                    style={{top: `${height() - 10}px`, left: `${menuOptionRight()}px`}}
                >
                    <For each={supportedProperties()}>
                        {(property) => (
                            <div
                                class={`drops ${props.data.activeProperty.id === property.id ? 'active' : ''}`}
                                onClick={() => {
                                    props.data.onChange({
                                        calculation: props.data.value,
                                        propertyId: property.id,
                                    })
                                }}
                            >
                                <span>{property.name}</span>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    )
}

export {
    Option,
    type OptionProps,
}
