import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Constants} from '../../constants'
import {Card} from '../../blocks/card'
import {BoardView} from '../../blocks/boardView'
import SortDownIcon from '../../widgets/icons/sortDown'
import SortUpIcon from '../../widgets/icons/sortUp'
import MenuWrapper from '../../widgets/menuWrapper'
import Label from '../../widgets/label'
import {useSortable} from '../../hooks/sortable'
import {Utils} from '../../utils'

import HorizontalGrip from './horizontalGrip'

import './table.scss'
import TableHeaderMenu from './tableHeaderMenu'
import {useColumnResize} from './tableColumnResizeContext'

type Props = {
    readonly: boolean
    sorted: 'up'|'down'|'none'
    name: JSX.Element
    board: Board
    activeView: BoardView
    cards: Card[]
    views: BoardView[]
    template: IPropertyTemplate
    onDrop: (template: IPropertyTemplate, container: IPropertyTemplate) => void
    onAutoSizeColumn: (columnID: string, headerWidth: number) => void
}

const TableHeader = (props: Props): JSX.Element => {
    const [isDragging, isOver, columnRef] = useSortable('column', () => props.template, () => !props.readonly, (src, dst) => props.onDrop(src, dst))

    const columnResize = useColumnResize()

    const onAutoSizeColumn = (templateId: string) => {
        let width = Constants.minColumnWidth
        if (columnRef.current) {
            const {fontDescriptor, padding} = Utils.getFontAndPaddingFromCell(columnRef.current)
            const textWidth = Utils.getTextWidth(columnRef.current.innerText.toUpperCase(), fontDescriptor)
            width = textWidth + padding
        }
        props.onAutoSizeColumn(templateId, width)
    }

    const classes = () => {
        let name = 'octo-table-cell header-cell'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }

    const templateId = () => props.template.id

    return (
        <div
            class={classes()}
            style={{
                overflow: 'unset',
                opacity: isDragging() ? 0.5 : 1,
                width: `${columnResize.width(templateId())}px`,
            }}
            ref={(ref) => {
                // The title column is not draggable, but every column measures.
                if (ref && templateId() !== Constants.titleColumnId) {
                    columnRef(ref)
                }
                columnResize.updateRef(Constants.tableHeaderId, templateId(), ref)
            }}
        >
            <MenuWrapper
                disabled={props.readonly}
                menu={
                    <TableHeaderMenu
                        board={props.board}
                        activeView={props.activeView}
                        views={props.views}
                        cards={props.cards}
                        templateId={templateId()}
                    />
                }
            >
                <Label>
                    {props.name}
                    <Show when={props.sorted === 'up'}><SortUpIcon/></Show>
                    <Show when={props.sorted === 'down'}><SortDownIcon/></Show>
                </Label>
            </MenuWrapper>

            <div class='octo-spacer'/>

            <Show when={!props.readonly}>
                <HorizontalGrip
                    templateId={templateId()}
                    columnWidth={props.activeView.fields.columnWidths[templateId()] || 0}
                    onAutoSizeColumn={onAutoSizeColumn}
                />
            </Show>
        </div>
    )
}

export default TableHeader
