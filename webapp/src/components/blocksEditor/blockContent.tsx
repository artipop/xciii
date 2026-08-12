import {Show, createUniqueId} from 'solid-js'
import {Dynamic} from 'solid-js/web'
import {useDraggable, useDragOperation, useDroppable} from '@dnd-kit/solid'

import GripIcon from '../../widgets/icons/grip'

import AddIcon from '../../widgets/icons/add'

import Editor from './editor'
import * as registry from './blocks'
import {BlockData} from './blocks/types'

import './blockContent.scss'

type Props = {
    boardId?: string
    block: BlockData
    contentOrder: string[]
    editing: BlockData|null
    setEditing: (block: BlockData|null) => void
    setAfterBlock: (block: BlockData|null) => void
    onSave: (block: BlockData) => Promise<BlockData|null>
    onMove: (block: BlockData, beforeBlock: BlockData|null, afterBlock: BlockData|null) => Promise<void>
}

function BlockContent(props: Props) {
    // Kept as raw draggable/droppable rather than useSortable because this block
    // needs to know *which* block is being dragged while hovering, to say whether
    // the drop would land above or below it. react-dnd read that off the monitor;
    // dnd-kit exposes it through the live drag operation.
    const id = createUniqueId()

    const {isDragging, ref: dragRef, handleRef: gripRef} = useDraggable({
        id: `block-drag-${id}`,
        type: 'block',
        get data() {
            return {item: props.block}
        },
    })

    const {isDropTarget, ref: dropRef} = useDroppable({
        id: `block-drop-${id}`,
        type: 'block',
        accept: 'block',
        get data() {
            return {
                item: props.block,
                handler: (src: BlockData) => {
                    if (src.id === props.block.id) {
                        return
                    }
                    if (props.contentOrder.indexOf(src.id || '') > props.contentOrder.indexOf(props.block.id || '')) {
                        props.onMove(src, props.block, null)
                    } else {
                        props.onMove(src, null, props.block)
                    }
                },
            }
        },
    })

    const {source} = useDragOperation()
    const draggedId = () => (source()?.data as {item?: BlockData} | undefined)?.item?.id
    const isOver = () => isDropTarget() && draggedId() !== props.block.id
    const draggingUp = () => Boolean(draggedId()) && props.contentOrder.indexOf(draggedId() || '') > props.contentOrder.indexOf(props.block.id || '')

    const contentType = () => registry.get(props.block.contentType)

    return (
        <Show
            when={!(props.editing && props.editing.id === props.block.id)}
            fallback={
                <Editor
                    onSave={async (b) => {
                        const updatedBlock = await props.onSave(b)
                        props.setEditing(null)
                        props.setAfterBlock(updatedBlock)
                        return updatedBlock
                    }}
                    id={props.block.id}
                    initialValue={props.block.value}
                    initialContentType={props.block.contentType}
                />
            }
        >
            <Show when={contentType() && contentType()!.Display}>
                <div
                    ref={(el) => {
                        dragRef(el as never)
                        dropRef(el as never)
                    }}
                    data-testid='block-content'
                    class={`BlockContent ${isOver() && draggingUp() ? 'over-up' : ''}  ${isOver() && !draggingUp() ? 'over-down' : ''}`}
                    style={{
                        opacity: isDragging() ? 0.5 : 1,
                    }}
                    onClick={() => {
                        props.setEditing(props.block)
                    }}
                >
                    <span
                        class='action'
                        data-testid='add-action'
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            props.setAfterBlock(props.block)
                        }}
                    >
                        <AddIcon/>
                    </span>
                    <span
                        class='action'
                        ref={gripRef}
                    >
                        <GripIcon/>
                    </span>
                    <div class='content'>
                        <Dynamic
                            component={contentType()!.Display}
                            value={props.block.value}
                            onChange={() => null}
                            onCancel={() => null}
                            onSave={(value: string) => props.onSave({...props.block, value})}
                            currentBoardId={props.boardId}
                        />
                    </div>
                </div>
            </Show>
        </Show>
    )
}

export default BlockContent
