import type {ParentComponent} from 'solid-js'

import {useDropZone} from '../../hooks/sortable'

import {Card} from '../../blocks/card'
import './kanbanColumn.scss'

type Props = {
    onDrop: (card: Card) => void

    // accepts is false where a column is not a place a card can be put: the
    // inbox groups by who brought the card, and that is not something a drop
    // can change.
    accepts?: boolean
}

const KanbanColumn: ParentComponent<Props> = (props) => {
    const [isOver, drop] = useDropZone<Card>('card', () => props.accepts !== false, (card) => props.onDrop(card))

    const classes = () => {
        let name = 'octo-board-column'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }
    return (
        <div
            ref={drop}
            class={classes()}
        >
            {props.children}
        </div>
    )
}

export default KanbanColumn
