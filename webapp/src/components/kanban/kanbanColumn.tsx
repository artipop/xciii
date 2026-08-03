// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useDropZone} from '../../hooks/sortable'

import {Card} from '../../blocks/card'
import './kanbanColumn.scss'

type Props = {
    onDrop: (card: Card) => void
    children: JSX.Element
}

const KanbanColumn = (props: Props) => {
    const [isOver, drop] = useDropZone<Card>('card', true, props.onDrop)

    let className = 'octo-board-column'
    if (isOver) {
        className += ' dragover'
    }
    return (
        <div
            ref={drop}
            class={className}
        >
            {props.children}
        </div>
    )
}

export default KanbanColumn
