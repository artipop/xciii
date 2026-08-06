// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {FilterClause, areEqual as areFilterClausesEqual} from '../../blocks/filterClause'
import {createFilterGroup, isAFilterGroupInstance} from '../../blocks/filterGroup'
import mutator from '../../mutator'
import {OctoUtils} from '../../octoUtils'
import {Utils} from '../../utils'
import {Board, IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import propsRegistry from '../../properties'

import FilterValue from './filterValue'

import './filterEntry.scss'

type Props = {
    board: Board
    view: BoardView
    conditionClicked: (optionId: string, filter: FilterClause) => void
    filter: FilterClause
}

const FilterEntry = (props: Props): JSX.Element => {
    const intl = useIntl()

    const template = () => props.board.cardProperties.find((o: IPropertyTemplate) => o.id === props.filter.propertyId)
    const propertyType = () => {
        if (props.filter.propertyId === 'title') {
            return propsRegistry.get('text')
        }
        return propsRegistry.get(template()?.type || 'unknown')
    }
    const propertyName = () => {
        if (props.filter.propertyId === 'title') {
            return 'Title'
        }
        return template() ? template()!.name : '(unknown)'
    }

    const conditionItem = (id: string, name: string) => (
        <Menu.Text
            id={id}
            name={name}
            onClick={(optionId) => props.conditionClicked(optionId, props.filter)}
        />
    )

    return (
        <div
            class='FilterEntry'
        >
            <MenuWrapper
                menu={
                    <Menu>
                        <Menu.Text
                            id={'title'}
                            name={intl.formatMessage({id: 'Filter.title-property', defaultMessage: 'Title'})}
                            onClick={(optionId: string) => {
                                const {view, filter} = props
                                const filterIndex = view.fields.filter.filters.indexOf(filter)
                                Utils.assert(filterIndex >= 0, "Can't find filter")
                                const filterGroup = createFilterGroup(view.fields.filter)
                                const newFilter = filterGroup.filters[filterIndex] as FilterClause
                                Utils.assert(newFilter, `No filter at index ${filterIndex}`)
                                if (newFilter.propertyId !== optionId) {
                                    newFilter.propertyId = optionId
                                    newFilter.values = []
                                    mutator.changeViewFilter(props.board.id, view.id, view.fields.filter, filterGroup)
                                }
                            }}
                        />
                        <For each={props.board.cardProperties.filter((o: IPropertyTemplate) => propsRegistry.get(o.type).canFilter)}>
                            {(o: IPropertyTemplate) => (
                                <Menu.Text
                                    id={o.id}
                                    name={o.name}
                                    onClick={(optionId: string) => {
                                        const {view, filter} = props
                                        const filterIndex = view.fields.filter.filters.indexOf(filter)
                                        Utils.assert(filterIndex >= 0, "Can't find filter")
                                        const filterGroup = createFilterGroup(view.fields.filter)
                                        const newFilter = filterGroup.filters[filterIndex] as FilterClause
                                        Utils.assert(newFilter, `No filter at index ${filterIndex}`)
                                        if (newFilter.propertyId !== optionId) {
                                            newFilter.propertyId = optionId
                                            newFilter.condition = OctoUtils.filterConditionValidOrDefault(propsRegistry.get(o.type).filterValueType, newFilter.condition)
                                            newFilter.values = []
                                            mutator.changeViewFilter(props.board.id, view.id, view.fields.filter, filterGroup)
                                        }
                                    }}
                                />
                            )}
                        </For>
                    </Menu>
                }
            >
                <Button>{propertyName()}</Button>
            </MenuWrapper>
            <MenuWrapper
                menu={
                    <Menu>
                        <Show when={propertyType().filterValueType === 'options'}>
                            {conditionItem('includes', intl.formatMessage({id: 'Filter.includes', defaultMessage: 'includes'}))}
                            {conditionItem('notIncludes', intl.formatMessage({id: 'Filter.not-includes', defaultMessage: 'doesn\'t include'}))}
                            {conditionItem('isEmpty', intl.formatMessage({id: 'Filter.is-empty', defaultMessage: 'is empty'}))}
                            {conditionItem('isNotEmpty', intl.formatMessage({id: 'Filter.is-not-empty', defaultMessage: 'is not empty'}))}
                        </Show>
                        <Show when={propertyType().filterValueType === 'person'}>
                            {conditionItem('includes', intl.formatMessage({id: 'Filter.includes', defaultMessage: 'includes'}))}
                            {conditionItem('notIncludes', intl.formatMessage({id: 'Filter.not-includes', defaultMessage: 'doesn\'t include'}))}
                        </Show>
                        <Show when={propertyType().type === 'person' || propertyType().type === 'multiPerson'}>
                            {conditionItem('isEmpty', intl.formatMessage({id: 'Filter.is-empty', defaultMessage: 'is empty'}))}
                            {conditionItem('isNotEmpty', intl.formatMessage({id: 'Filter.is-not-empty', defaultMessage: 'is not empty'}))}
                        </Show>
                        <Show when={propertyType().filterValueType === 'boolean'}>
                            {conditionItem('isSet', intl.formatMessage({id: 'Filter.is-set', defaultMessage: 'is set'}))}
                            {conditionItem('isNotSet', intl.formatMessage({id: 'Filter.is-not-set', defaultMessage: 'is not set'}))}
                        </Show>
                        <Show when={propertyType().filterValueType === 'text'}>
                            {conditionItem('is', intl.formatMessage({id: 'Filter.is', defaultMessage: 'is'}))}
                            {conditionItem('contains', intl.formatMessage({id: 'Filter.contains', defaultMessage: 'contains'}))}
                            {conditionItem('notContains', intl.formatMessage({id: 'Filter.not-contains', defaultMessage: 'doesn\'t contain'}))}
                            {conditionItem('startsWith', intl.formatMessage({id: 'Filter.starts-with', defaultMessage: 'starts with'}))}
                            {conditionItem('notStartsWith', intl.formatMessage({id: 'Filter.not-starts-with', defaultMessage: 'doesn\'t start with'}))}
                            {conditionItem('endsWith', intl.formatMessage({id: 'Filter.ends-with', defaultMessage: 'ends with'}))}
                            {conditionItem('notEndsWith', intl.formatMessage({id: 'Filter.not-ends-with', defaultMessage: 'doesn\'t end with'}))}
                        </Show>
                        <Show when={propertyType().filterValueType === 'date'}>
                            {conditionItem('is', intl.formatMessage({id: 'Filter.is', defaultMessage: 'is'}))}
                            {conditionItem('isBefore', intl.formatMessage({id: 'Filter.isbefore', defaultMessage: 'is before'}))}
                            {conditionItem('isAfter', intl.formatMessage({id: 'Filter.isafter', defaultMessage: 'is after'}))}
                        </Show>
                        <Show when={propertyType().type === 'date'}>
                            {conditionItem('isSet', intl.formatMessage({id: 'Filter.is-set', defaultMessage: 'is set'}))}
                            {conditionItem('isNotSet', intl.formatMessage({id: 'Filter.is-not-set', defaultMessage: 'is not set'}))}
                        </Show>
                    </Menu>
                }
            >
                <Button>{OctoUtils.filterConditionDisplayString(props.filter.condition, intl, propertyType().filterValueType)}</Button>
            </MenuWrapper>
            <FilterValue
                filter={props.filter}
                template={template()}
                view={props.view}
                propertyType={propertyType()}
            />
            <div class='octo-spacer'/>
            <Button
                onClick={() => {
                    const {view, filter} = props
                    const filterGroup = createFilterGroup(view.fields.filter)
                    filterGroup.filters = filterGroup.filters.filter((o) => isAFilterGroupInstance(o) || !areFilterClausesEqual(o, filter))
                    mutator.changeViewFilter(props.board.id, view.id, view.fields.filter, filterGroup)
                }}
            >
                <FormattedMessage
                    id='FilterComponent.delete'
                    defaultMessage='Delete'
                />
            </Button>
        </div>
    )
}

export default FilterEntry
