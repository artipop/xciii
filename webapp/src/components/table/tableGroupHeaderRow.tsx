import {For, Show, createEffect, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Constants} from '../../constants'
import {IPropertyOption, Board, IPropertyTemplate, BoardGroup} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {useSortable} from '../../hooks/sortable'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import IconButton from '../../widgets/buttons/iconButton'
import AddIcon from '../../widgets/icons/add'
import DeleteIcon from '../../widgets/icons/delete'
import CompassIcon from '../../widgets/icons/compassIcon'
import HideIcon from '../../widgets/icons/hide'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import Editable from '../../widgets/editable'
import Label from '../../widgets/label'

import {useColumnResize} from './tableColumnResizeContext'

type Props = {
    board: Board
    activeView: BoardView
    group: BoardGroup
    groupByProperty?: IPropertyTemplate
    readonly: boolean
    hideGroup: (groupByOptionId: string) => void
    addCard: (groupByOptionId?: string) => Promise<void>
    propertyNameChanged: (option: IPropertyOption, text: string) => Promise<void>
    onDrop: (srcOption: IPropertyOption, dstOption?: IPropertyOption) => void
}

const TableGroupHeaderRow = (props: Props): JSX.Element => {
    const [groupTitle, setGroupTitle] = createSignal(props.group.option.value)

    const [isDragging, isOver, groupHeaderRef] = useSortable('groupHeader', () => props.group.option, () => !props.readonly, (src: IPropertyOption, dst?: IPropertyOption) => props.onDrop(src, dst))
    const intl = useIntl()
    const columnResize = useColumnResize()

    createEffect(() => {
        setGroupTitle(props.group.option.value)
    })

    const classes = () => {
        let name = 'octo-group-header-cell'
        if (isOver()) {
            name += ' dragover'
        }
        if (props.activeView.fields.collapsedOptionIds.indexOf(props.group.option.id || 'undefined') < 0) {
            name += ' expanded'
        }
        return name
    }

    const canEditOption = () => props.groupByProperty?.type !== 'person' && props.group.option.id

    return (
        <div
            ref={groupHeaderRef}
            style={{opacity: isDragging() ? 0.5 : 1}}
            class={classes()}
        >
            <div
                class='octo-table-cell'
                style={{width: `${columnResize.width(Constants.titleColumnId)}px`}}
                ref={(ref) => columnResize.updateRef(props.group.option.id, Constants.titleColumnId, ref)}
            >
                <IconButton
                    icon={
                        <CompassIcon
                            icon='menu-right'
                        />}
                    onClick={() => (props.readonly ? {} : props.hideGroup(props.group.option.id || 'undefined'))}
                    class={`octo-table-cell__expand ${props.readonly ? 'readonly' : ''}`}
                />

                <Show when={!props.group.option.id}>
                    <Label
                        title={intl.formatMessage({
                            id: 'BoardComponent.no-property-title',
                            defaultMessage: 'Items with an empty {property} property will go here. This column cannot be removed.',
                        }, {property: props.groupByProperty?.name})}
                    >
                        <FormattedMessage
                            id='BoardComponent.no-property'
                            defaultMessage='No {property}'
                            values={{
                                property: props.groupByProperty?.name,
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
                            readonly={props.readonly || !props.group.option.id}
                            spellCheck={true}
                        />
                    </Label>
                </Show>
            </div>
            <Button>{`${props.group.cards.length}`}</Button>
            <Show when={!props.readonly}>
                <MenuWrapper
                    menu={
                        <Menu>
                            <Menu.Text
                                id='hide'
                                icon={<HideIcon/>}
                                name={intl.formatMessage({id: 'BoardComponent.hide', defaultMessage: 'Hide'})}
                                onClick={() => mutator.hideViewColumn(props.board.id, props.activeView, props.group.option.id || '')}
                            />
                            <Show when={canEditOption()}>
                                <Menu.Text
                                    id='delete'
                                    icon={<DeleteIcon/>}
                                    name={intl.formatMessage({id: 'BoardComponent.delete', defaultMessage: 'Delete'})}
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
                <IconButton
                    icon={<AddIcon/>}
                    onClick={() => props.addCard(props.group.option.id)}
                />
            </Show>
        </div>
    )
}

export default TableGroupHeaderRow
