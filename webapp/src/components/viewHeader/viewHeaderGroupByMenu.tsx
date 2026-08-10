// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createMemo} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {BoardGroup, IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import CheckIcon from '../../widgets/icons/check'
import HideIcon from '../../widgets/icons/hide'
import ShowIcon from '../../widgets/icons/show'
import {useAppSelector} from '../../store/hooks'
import {getCurrentViewCardsSortedFilteredAndGrouped} from '../../store/cards'
import {getVisibleAndHiddenGroups} from '../../boardUtils'
import propsRegistry from '../../properties'

type Props = {
    properties: readonly IPropertyTemplate[]
    activeView: BoardView
    groupByProperty?: IPropertyTemplate
}

const ViewHeaderGroupByMenu = (props: Props) => {
    const intl = useIntl()

    const cards = useAppSelector(getCurrentViewCardsSortedFilteredAndGrouped)
    const groups = createMemo(() => getVisibleAndHiddenGroups(cards(), props.activeView.fields.visibleOptionIds, props.activeView.fields.hiddenOptionIds, props.groupByProperty))

    const emptyVisibleGroups = () => groups().visible.filter((g) => !g.cards.length)
    const emptyVisibleGroupsCount = () => emptyVisibleGroups().length
    const hiddenGroupsCount = () => groups().hidden.length

    const handleToggleGroups = (show: boolean) => {
        const getColumnIds = (boardGroups: BoardGroup[]) => boardGroups.map((g) => g.option.id)

        if (show) {
            const columnsToShow = getColumnIds(groups().hidden)
            mutator.unhideViewColumns(props.activeView.boardId, props.activeView, columnsToShow)
        } else {
            const columnsToHide = getColumnIds(emptyVisibleGroups())
            mutator.hideViewColumns(props.activeView.boardId, props.activeView, columnsToHide)
        }
    }

    return (
        <MenuWrapper
            menu={
                <Menu>
                    <Show when={props.activeView.fields.viewType === 'table' && props.activeView.fields.groupById}>
                        <Show when={emptyVisibleGroupsCount() > 0}>
                            <Menu.Text
                                id={'hideEmptyGroups'}
                                name={intl.formatMessage({id: 'GroupBy.hideEmptyGroups', defaultMessage: 'Hide {count, plural, one {# empty group} other {# empty groups}}'}, {count: emptyVisibleGroupsCount()})}
                                rightIcon={<HideIcon/>}
                                onClick={() => handleToggleGroups(false)}
                            />
                        </Show>
                        <Show when={hiddenGroupsCount() > 0}>
                            <Menu.Text
                                id={'showHiddenGroups'}
                                name={intl.formatMessage({id: 'GroupBy.showHiddenGroups', defaultMessage: 'Show {count, plural, one {# hidden group} other {# hidden groups}}'}, {count: hiddenGroupsCount()})}
                                rightIcon={<ShowIcon/>}
                                onClick={() => handleToggleGroups(true)}
                            />
                        </Show>
                        <Menu.Text
                            id={''}
                            name={intl.formatMessage({id: 'GroupBy.ungroup', defaultMessage: 'Ungroup'})}
                            rightIcon={props.activeView.fields.groupById === '' ? <CheckIcon/> : undefined}
                            onClick={(id) => {
                                if (props.activeView.fields.groupById === id) {
                                    return
                                }
                                mutator.changeViewGroupById(props.activeView.boardId, props.activeView.id, props.activeView.fields.groupById, id)
                            }}
                        />
                        <Menu.Separator/>
                    </Show>
                    <For each={props.properties?.filter((o: IPropertyTemplate) => propsRegistry.get(o.type).canGroup)}>
                        {(option: IPropertyTemplate) => (
                            <Menu.Text
                                id={option.id}
                                name={option.name}
                                rightIcon={props.groupByProperty?.id === option.id ? <CheckIcon/> : undefined}
                                onClick={(id) => {
                                    if (props.activeView.fields.groupById === id) {
                                        return
                                    }

                                    mutator.changeViewGroupById(props.activeView.boardId, props.activeView.id, props.activeView.fields.groupById, id)
                                }}
                            />
                        )}
                    </For>
                </Menu>
            }
        >
            <Button>
                <FormattedMessage
                    id='ViewHeader.group-by'
                    defaultMessage='Group by: {property}'
                    values={{
                        property: (
                            <span
                                style={{color: 'rgb(var(--center-channel-color-rgb))'}}
                                id='groupByLabel'
                            >
                                {props.groupByProperty?.name}
                            </span>
                        ),
                    }}
                />
            </Button>
        </MenuWrapper>
    )
}

export default ViewHeaderGroupByMenu
