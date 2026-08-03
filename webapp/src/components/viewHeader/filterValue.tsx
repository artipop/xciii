// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Match, Switch, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {PropertyType} from '../../properties/types'
import {IPropertyTemplate} from '../../blocks/board'
import {FilterClause} from '../../blocks/filterClause'
import {createFilterGroup} from '../../blocks/filterGroup'
import {BoardView} from '../../blocks/boardView'
import mutator from '../../mutator'
import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import Editable from '../../widgets/editable'
import MenuWrapper from '../../widgets/menuWrapper'

import DateFilter from './dateFilter'

import './filterValue.scss'
import MultiPersonFilterValue from './multipersonFilterValue'

type Props = {
    view: BoardView
    filter: FilterClause
    template?: IPropertyTemplate
    propertyType: PropertyType
}

const FilterValue = (props: Props): JSX.Element => {
    const [value, setValue] = createSignal(props.filter.values.length > 0 ? props.filter.values[0] : '')
    const intl = useIntl()

    const hidden = () => {
        const {propertyType, filter} = props
        if (propertyType.filterValueType === 'none' || propertyType.filterValueType === 'boolean') {
            return true
        }
        if ((propertyType.filterValueType === 'options' || propertyType.filterValueType === 'person') && filter.condition !== 'includes' && filter.condition !== 'notIncludes') {
            return true
        }
        if (propertyType.filterValueType === 'date' && (filter.condition === 'isSet' || filter.condition === 'isNotSet')) {
            return true
        }
        return false
    }

    const displayValue = () => {
        if (props.filter.values.length > 0) {
            return props.filter.values.map((id) => {
                const option = props.template?.options.find((o) => o.id === id)
                return option?.value || '(Unknown)'
            }).join(', ')
        }
        return intl.formatMessage({id: 'FilterValue.empty', defaultMessage: '(empty)'})
    }

    return (
        <Switch>
            <Match when={hidden()}>{null}</Match>
            <Match when={props.propertyType.filterValueType === 'text'}>
                <Editable
                    onChange={setValue}
                    value={value()}
                    placeholderText={intl.formatMessage({id: 'FilterByText.placeholder', defaultMessage: 'filter text'})}
                    onSave={() => {
                        const {view, filter} = props
                        const filterIndex = view.fields.filter.filters.indexOf(filter)
                        Utils.assert(filterIndex >= 0, "Can't find filter")

                        const filterGroup = createFilterGroup(view.fields.filter)
                        const newFilter = filterGroup.filters[filterIndex] as FilterClause
                        Utils.assert(newFilter, `No filter at index ${filterIndex}`)

                        newFilter.values = [value()]
                        mutator.changeViewFilter(view.boardId, view.id, view.fields.filter, filterGroup)
                    }}
                />
            </Match>
            <Match when={props.propertyType.filterValueType === 'person'}>
                <MultiPersonFilterValue
                    view={props.view}
                    filter={props.filter}
                />
            </Match>
            <Match when={props.propertyType.filterValueType === 'date'}>
                <DateFilter
                    view={props.view}
                    filter={props.filter}
                />
            </Match>
            <Match when={true}>
                <MenuWrapper
                    className='filterValue'
                    menu={
                        <Menu>
                            <For each={props.template?.options}>
                                {(o) => (
                                    <Menu.Switch
                                        id={o.id}
                                        name={o.value}
                                        isOn={props.filter.values.includes(o.id)}
                                        suppressItemClicked={true}
                                        onClick={(optionId) => {
                                            const {view, filter} = props
                                            const filterIndex = view.fields.filter.filters.indexOf(filter)
                                            Utils.assert(filterIndex >= 0, "Can't find filter")

                                            const filterGroup = createFilterGroup(view.fields.filter)
                                            const newFilter = filterGroup.filters[filterIndex] as FilterClause
                                            Utils.assert(newFilter, `No filter at index ${filterIndex}`)
                                            if (filter.values.includes(o.id)) {
                                                newFilter.values = newFilter.values.filter((id) => id !== optionId)
                                                mutator.changeViewFilter(view.boardId, view.id, view.fields.filter, filterGroup)
                                            } else {
                                                newFilter.values.push(optionId)
                                                mutator.changeViewFilter(view.boardId, view.id, view.fields.filter, filterGroup)
                                            }
                                        }}
                                    />
                                )}
                            </For>
                        </Menu>
                    }
                >
                    <Button>{displayValue()}</Button>
                </MenuWrapper>
            </Match>
        </Switch>
    )
}

export default FilterValue
