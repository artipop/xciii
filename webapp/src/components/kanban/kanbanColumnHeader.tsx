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
import {useAppSelector} from '../../store/hooks'
import {getBoardUsers, getMe} from '../../store/users'
import {IUser} from '../../user'
import {personNameById} from '../../userDisplay'

import BoardPermissionGate from '../permissions/boardPermissionGate'

import ColumnBadge from '../acp/columnBadge'
import {isAutomationAvailable} from '../acp/automationDialog'
import {MineColumnTitle, isInboxView} from '../acp/inboxView'

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

    // Opening the automation editor is the parent's job: the dialog cannot live
    // in this header, because a board edit made from inside it (a palette
    // block dropping a new column, say) re-creates every header and would take
    // the dialog down with it.
    onOpenSettings: (optionId: string) => void
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

    // Who a group is, when the board is grouped by a person rather than by an
    // option: «кто создал» groups by user id, and an id is not a heading.
    const boardUsers = useAppSelector<{[key: string]: IUser}>(getBoardUsers)
    const me = useAppSelector<IUser|null>(getMe)
    const isPersonGroup = () => {
        const type = props.groupByProperty?.type
        return type === 'person' || type === 'createdBy' || type === 'updatedBy'
    }
    const personName = () => {
        const id = props.group.option.id

        // On the inbox the columns say who brought the card, and what the
        // person themselves brought is their unprocessed tasks: the column is
        // headed by what those cards are, not by who typed them.
        if (isInboxView(props.activeView) && id === me()?.id) {
            return MineColumnTitle
        }
        return personNameById(props.intl, id, boardUsers())
    }

    // A person group has no option behind it to rename, so it is a label and
    // not an editable one — renaming it would write to nothing.
    const canEditOption = () => !isPersonGroup() && props.group.option.id

    const [isDragging, isOver, headerRef] = useSortable(
        'column',
        () => props.group.option,
        () => Boolean(canEditBoardProperties()),
        (src: IPropertyOption) => props.onDropToColumn(src, undefined, props.group.option),
    )

    createEffect(() => {
        setGroupTitle(props.group.option.value)
    })

    const classes = () => {
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
            class={classes()}
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
            <Show when={isPersonGroup() && props.group.option.id}>
                <Label>
                    {personName()}
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
                                {/* A column's settings are a panel of the
                                    board's automation now, so this opens the
                                    whole picture with this column selected
                                    rather than a dialog of its own. */}
                                <Show when={canEditOption() && isAutomationAvailable()}>
                                    <Menu.Text
                                        id='columnAgents'
                                        name={props.intl.formatMessage({id: 'BoardComponent.column-agents', defaultMessage: 'What happens in this column…'})}
                                        onClick={() => props.onOpenSettings(props.group.option.id)}
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
        </div>
    )
}
