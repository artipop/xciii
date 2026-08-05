// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createEffect, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, IntlShape} from '../../intl'

import {Constants, Permission} from '../../constants'
import {IPropertyOption, IPropertyTemplate, Board, BoardGroup} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import mutator from '../../mutator'
import IconButton from '../../widgets/buttons/iconButton'
import AddIcon from '../../widgets/icons/add'
import DeleteIcon from '../../widgets/icons/delete'
import HideIcon from '../../widgets/icons/hide'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import Editable from '../../widgets/editable'
import Label from '../../widgets/label'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import {useSortable} from '../../hooks/sortable'

import BoardPermissionGate from '../permissions/boardPermissionGate'

import ColumnBadge, {invalidateBoardColumns} from '../acp/columnBadge'
import ColumnSettingsDialog, {isColumnSettingsAvailable} from '../acp/columnSettingsDialog'

import {KanbanCalculation} from './calculation/calculation'

type Props = {
    board: Board
    activeView: BoardView
    group: BoardGroup
    groupByProperty?: IPropertyTemplate
    intl: IntlShape
    readonly: boolean
    addCard: (groupByOptionId?: string, show?: boolean) => Promise<void>
    propertyNameChanged: (option: IPropertyOption, text: string) => Promise<void>
    onDropToColumn: (srcOption: IPropertyOption, card?: Card, dstOption?: IPropertyOption) => void
    calculationMenuOpen: boolean
    onCalculationMenuOpen: () => void
    onCalculationMenuClose: () => void
}

const defaultCalculation = 'count'
const defaultProperty: IPropertyTemplate = {
    id: Constants.titleColumnId,
} as IPropertyTemplate

export default function KanbanColumnHeader(props: Props): JSX.Element {
    const [groupTitle, setGroupTitle] = createSignal(props.group.option.value)
    const canEditBoardProperties = useHasCurrentBoardPermissions([Permission.ManageBoardProperties])
    const canEditOption = () => props.groupByProperty?.type !== 'person' && props.group.option.id

    const [showColumnSettings, setShowColumnSettings] = createSignal(false)

    const [isDragging, isOver, headerRef] = useSortable(
        'column',
        () => props.group.option,
        () => Boolean(canEditBoardProperties()),
        (src: IPropertyOption) => props.onDropToColumn(src, undefined, props.group.option),
    )

    createEffect(() => {
        setGroupTitle(props.group.option.value)
    })

    const className = () => {
        let name = 'octo-board-header-cell KanbanColumnHeader'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }

    const groupCalculation = () => props.activeView.fields.kanbanCalculations[props.group.option.id]
    const calculationValue = () => (groupCalculation() ? groupCalculation().calculation : defaultCalculation)
    const calculationProperty = () => (groupCalculation() ? props.board.cardProperties.find((property) => property.id === groupCalculation().propertyId) || defaultProperty : defaultProperty)
    return (
        <div
            ref={headerRef}
            style={{opacity: isDragging() ? 0.5 : 1}}
            class={className()}
        >
            <Show when={!props.group.option.id}>
                <Label
                    title={props.intl.formatMessage({
                        id: 'BoardComponent.no-property-title',
                        defaultMessage: 'Items with an empty {property} property will go here. This column cannot be removed.',
                    }, {property: props.groupByProperty!.name})}
                >
                    <FormattedMessage
                        id='BoardComponent.no-property'
                        defaultMessage='No {property}'
                        values={{
                            property: props.groupByProperty!.name,
                        }}
                    />
                </Label>
            </Show>
            <Show when={props.groupByProperty?.type === 'person'}>
                <Label>
                    {groupTitle()}
                </Label>
            </Show>
            <Show when={canEditOption()}>
                <Label color={props.group.option.color}>
                    <Editable
                        value={groupTitle()}
                        placeholderText='New Select'
                        onChange={setGroupTitle}
                        onSave={() => {
                            if (groupTitle().trim() === '') {
                                setGroupTitle(props.group.option.value)
                            }
                            props.propertyNameChanged(props.group.option, groupTitle())
                        }}
                        onCancel={() => {
                            setGroupTitle(props.group.option.value)
                        }}
                        readonly={props.readonly || !canEditBoardProperties()}
                        spellCheck={true}
                    />
                </Label>
            </Show>
            <KanbanCalculation
                cards={props.group.cards}
                menuOpen={props.calculationMenuOpen}
                value={calculationValue()}
                property={calculationProperty()}
                onMenuClose={props.onCalculationMenuClose}
                onMenuOpen={props.onCalculationMenuOpen}
                cardProperties={props.board.cardProperties}
                readonly={props.readonly || !canEditBoardProperties()}
                onChange={(data: {calculation: string, propertyId: string}) => {
                    if (data.calculation === calculationValue() && data.propertyId === calculationProperty().id) {
                        return
                    }

                    const newCalculations = {
                        ...props.activeView.fields.kanbanCalculations,
                    }
                    newCalculations[props.group.option.id] = {
                        calculation: data.calculation,
                        propertyId: data.propertyId,
                    }

                    mutator.changeViewKanbanCalculations(props.board.id, props.activeView.id, props.activeView.fields.kanbanCalculations, newCalculations)
                }}
            />
            <Show when={Boolean(props.group.option.id) && props.groupByProperty}>
                <ColumnBadge
                    boardId={props.board.id}
                    optionId={props.group.option.id}
                    columnName={props.group.option.value}
                />
            </Show>
            <div class='octo-spacer'/>
            <Show when={!props.readonly}>
                <BoardPermissionGate permissions={[Permission.ManageBoardProperties]}>
                    <MenuWrapper
                        menu={
                            <Menu>
                                <Menu.Text
                                    id='hide'
                                    icon={<HideIcon/>}
                                    name={props.intl.formatMessage({id: 'BoardComponent.hide', defaultMessage: 'Hide'})}
                                    onClick={() => mutator.hideViewColumn(props.board.id, props.activeView, props.group.option.id || '')}
                                />
                                <Show when={canEditOption() && isColumnSettingsAvailable()}>
                                    <Menu.Text
                                        id='columnAgents'
                                        name={props.intl.formatMessage({id: 'BoardComponent.column-agents', defaultMessage: 'Agents in this column…'})}
                                        onClick={() => setShowColumnSettings(true)}
                                    />
                                </Show>
                                <Show when={canEditOption()}>
                                    <Menu.Text
                                        id='delete'
                                        icon={<DeleteIcon/>}
                                        name={props.intl.formatMessage({id: 'BoardComponent.delete', defaultMessage: 'Delete'})}
                                        onClick={() => mutator.deletePropertyOption(props.board.id, props.board.cardProperties, props.groupByProperty!, props.group.option)}
                                    />
                                    <Menu.Separator/>
                                    <For each={Object.entries(Constants.menuColors)}>
                                        {([key, color]) => (
                                            <Menu.Color
                                                id={key}
                                                name={color}
                                                onClick={() => mutator.changePropertyOptionColor(props.board.id, props.board.cardProperties, props.groupByProperty!, props.group.option, key)}
                                            />
                                        )}
                                    </For>
                                </Show>
                            </Menu>
                        }
                    >
                        <IconButton icon={<OptionsIcon/>}/>
                    </MenuWrapper>
                </BoardPermissionGate>
                <BoardPermissionGate permissions={[Permission.ManageBoardCards]}>
                    <IconButton
                        icon={<AddIcon/>}
                        onClick={() => {
                            props.addCard(props.group.option.id, true)
                        }}
                    />
                </BoardPermissionGate>
            </Show>
            <Show when={showColumnSettings() && props.groupByProperty}>
                <ColumnSettingsDialog
                    boardId={props.board.id}
                    property={props.groupByProperty!}
                    option={props.group.option}
                    onClose={() => setShowColumnSettings(false)}
                    onSaved={invalidateBoardColumns}
                />
            </Show>
        </div>
    )
}
