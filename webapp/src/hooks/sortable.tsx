// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createMemo, createUniqueId} from 'solid-js'
import type {Accessor, ParentComponent} from 'solid-js'
import {DragDropProvider, useDragDropMonitor, useDraggable, useDroppable, type DragDropEventHandlers} from '@dnd-kit/solid'
import {useSortable as useDndSortable} from '@dnd-kit/solid/sortable'
import {SortableKeyboardPlugin} from '@dnd-kit/dom/sortable'
import {defaultCollisionDetection, type CollisionDetector} from '@dnd-kit/collision'
import {defaultPreset, Feedback, KeyboardSensor, PointerActivationConstraints, PointerSensor, type DragEndEvent} from '@dnd-kit/dom'

import {IContentBlockWithCords} from '../blocks/contentBlock'
import {Block} from '../blocks/block'

interface ISortableWithGripItem {
    block: Block | Block[]
    cords: {x: number, y?: number, z?: number}
}

// react-dnd let every drop target own its drop handler; dnd-kit dispatches a
// single dragend at the provider. To keep the call sites unchanged, each
// droppable carries its item and handler here and SortableProvider dispatches.
type DroppableData = {
    item: unknown
    handler: (src: never, dst: never) => void
}

type DraggableData = {
    item: unknown
}

// The same element is both draggable and droppable, so while a card is being
// dragged its own drop zone travels with the pointer, contains it at every
// moment, and wins every collision on pointer intersection -- after which the
// drop is thrown away as a drop onto itself and nothing else was ever
// considered. Disabling the zone when the drag starts is too late: the eligible
// targets are settled by then. Declining the collision is not.
function ignoringSelf(item: () => unknown): CollisionDetector {
    return (input) => {
        const source = input.dragOperation.source?.data as DraggableData | undefined
        if (source && source.item === item()) {
            return null
        }
        return defaultCollisionDetection(input)
    }
}

// Our handlers move the card, which unmounts the element that was just being
// dragged -- and dragend is dispatched in the middle of dnd-kit tearing the
// operation down, not after it. A source destroyed during the dispatch takes
// its Feedback effects with it and nothing is left to bring its status back to
// idle; the operation then never resets and every later press is silently
// dropped. The reasoning is spelled out at length in the React version's
// history; the race is the framework's renderer racing dnd-kit's teardown, and
// Solid tearing the node down synchronously makes it no less real.
//
// A task, not a microtask: the teardown is itself a chain of promise
// callbacks, and the point is to come after all of them.
function afterDragTeardown(run: () => void): void {
    setTimeout(run, 0)
}

// Exported so the dispatch can be tested: everything else here needs real
// pointer events and real element geometry, which jsdom has neither of.
export function dispatchDrop(event: DragEndEvent): void {
    if (event.canceled) {
        return
    }
    const {source, target} = event.operation
    if (!source || !target) {
        return
    }

    const from = (source.data as DraggableData | undefined)?.item
    const to = target.data as DroppableData | undefined

    // Sortables registered elsewhere (the sidebar) share this provider but
    // handle their own dragend, so anything without a handler is not ours.
    if (!to || typeof to.handler !== 'function' || from === undefined) {
        return
    }

    // Every card is both draggable and droppable, so dropping one on itself
    // has to be a no-op. react-dnd never reported that; dnd-kit can.
    if (from === to.item) {
        return
    }

    afterDragTeardown(() => to.handler(from as never, to.item as never))
}

// dnd-kit resets a finished operation only once the dragged element reports
// itself idle, and that happens at the end of its drop animation. Our handlers
// move the card the moment the drop lands, so the element unmounts
// mid-animation, it never goes idle, the reset never runs -- and the manager
// goes on believing a drag is in progress, ignoring every press after it. The
// animation plays the element back to where it started, which is never where it
// belongs here; without one, dnd-kit cleans up synchronously instead.
const plugins = defaultPreset.plugins.map((plugin) => (
    plugin === Feedback ? Feedback.configure({dropAnimation: null}) : plugin
))

// dnd-kit's mouse default pairs a Delay with a Distance and gives them one
// controller, and the Delay aborts the whole activation if the pointer travels
// further than its tolerance before the timer fires. So a quick flick of the
// mouse -- more than 10px inside 200ms -- cancels a drag that the Distance
// constraint would have started at 5px, and the press is lost. Distance alone
// for a mouse, which is also what react-beautiful-dnd asked for; touch keeps a
// hold, or dragging would fight scrolling; a real grip needs no threshold,
// because holding one is already the request to drag.
const sensors = [
    PointerSensor.configure({
        activationConstraints(event, source) {
            if (event.pointerType === 'touch') {
                return [new PointerActivationConstraints.Delay({value: 250, tolerance: 5})]
            }
            if (source.handle && event.target instanceof Element && source.handle.contains(event.target)) {
                return undefined
            }
            return [new PointerActivationConstraints.Distance({value: 5})]
        },
    }),
    KeyboardSensor,
]

// On the manager's monitor rather than on DragDropProvider props: under React
// the provider wrapped its handlers in a renderer-tracking transition that
// could starve the drag's promotion to 'dragging' and wedge the manager, and
// the monitor was the way around it. The Solid provider has no transitions,
// but the monitor keeps the dispatch out of the provider's render path either
// way, and the shape of the fix is worth keeping.
const monitorHandlers: DragDropEventHandlers = {
    onDragEnd: (event) => dispatchDrop(event as DragEndEvent),
}

function DragMonitor(): null {
    useDragDropMonitor(monitorHandlers)
    return null
}

export const SortableProvider: ParentComponent = (props) => {
    return (
        <DragDropProvider
            plugins={plugins}
            sensors={sensors}
        >
            <DragMonitor/>
            {props.children}
        </DragDropProvider>
    )
}

// The call sites want two things of one ref: to hand it to dnd-kit (which
// wants to be told at attach and detach) and to read the element back
// (tableHeader measures the column). A callback that also answers `.current`
// serves both, exactly as the React version did.
export type AttachRef = ((element: Element | null | undefined) => void) & {current: HTMLElement | null}

function makeAttachRef(attach: (element: Element | undefined) => void): AttachRef {
    let current: HTMLElement | null = null
    const ref = (element: Element | null | undefined): void => {
        current = (element as HTMLElement) || null
        attach(element || undefined)
    }
    Object.defineProperty(ref, 'current', {get: () => current})
    return ref as AttachRef
}

// Where the item sits: which list, and where in it. A sortable that is told this
// is a different thing from a draggable that happens to sit next to others --
// dnd-kit can then say a card left column A for column B, rather than only that
// something was released over something else.
export type ListPosition = {
    id: string
    index: number
    group?: string
}

// An item with a place in a list, expressed as dnd-kit means it to be: one
// sortable, which owns its own draggable and droppable, rather than a draggable
// and a droppable we pair up on the same element ourselves. That pairing is what
// made a card collide with itself and needed a collision detector to decline it;
// a sortable has no such problem, and brings the live reordering that
// react-beautiful-dnd had and the hand-rolled version lost.
export function useListSortable<T>(
    itemType: string,
    item: () => T,
    enabled: () => boolean,
    handler: (src: T, dst: T) => void,
    position: () => ListPosition,
): [Accessor<boolean>, Accessor<boolean>, AttachRef] {
    const {ref, isDragSource, isDropTarget} = useDndSortable<DroppableData>({
        get id() {
            return position().id
        },
        get index() {
            return position().index
        },
        get group() {
            return position().group
        },
        type: itemType,
        accept: itemType,
        get disabled() {
            return !enabled()
        },
        get data() {
            return {item: item(), handler: handler as (src: never, dst: never) => void}
        },

        // Without this the default set brings OptimisticSortingPlugin, which
        // reorders the cards in the DOM itself as you drag. That is a second
        // owner of nodes the framework owns, and the first render that removes
        // a card it had already moved corrupts the tree for good.
        // Registration is global rather than per sortable, so every useSortable
        // in the application has to leave it out, not just this one.
        plugins: [SortableKeyboardPlugin],
    })

    return [isDragSource, isDropTarget, makeAttachRef(ref)]
}

function useSortableBase<T>(itemType: string, item: () => T, enabled: () => boolean, handler: (src: T, dst: T) => void) {
    const id = createUniqueId()

    const attachedElement = {current: undefined as Element | undefined}
    const attachedHandle = {current: undefined as Element | undefined}

    const {isDragging, ref: dragRef, handleRef: dragHandleRef} = useDraggable<DraggableData>({
        id: `drag-${itemType}-${id}`,
        type: itemType,
        get disabled() {
            return !enabled()
        },
        get data() {
            return {item: item()}
        },
    })

    // Kept stable on purpose: a detector that changed identity underneath a
    // live drag would be handed to dnd-kit again mid-operation. The item is
    // read through the accessor at collision time instead.
    const collisionDetector = createMemo(() => ignoringSelf(item))

    const {isDropTarget, ref: dropRef} = useDroppable<DroppableData>({
        id: `drop-${itemType}-${id}`,
        type: itemType,
        accept: itemType,
        get disabled() {
            return !enabled()
        },
        collisionDetector: collisionDetector(),
        get data() {
            return {item: item(), handler: handler as (src: never, dst: never) => void}
        },
    })

    // One element feeds both halves, as the React version's shared ref did.
    const ref = makeAttachRef((element) => {
        attachedElement.current = element
        dragRef(element as never)
        dropRef(element as never)
    })

    const handleRef = makeAttachRef((element) => {
        attachedHandle.current = element
        dragHandleRef(element as never)
    })

    return {isDragging, isOver: isDropTarget, ref, handleRef}
}

// A zone that only receives. react-dnd needed `monitor.isOver({shallow: true})`
// here so an outer zone would not also claim a drop meant for a card inside it;
// dnd-kit resolves collisions to a single target, so that is now the default.
export function useDropZone<T>(itemType: string, enabled: () => boolean, handler: (src: T) => void): [Accessor<boolean>, AttachRef] {
    const id = createUniqueId()

    const {isDropTarget, ref} = useDroppable<DroppableData>({
        id: `zone-${itemType}-${id}`,
        type: itemType,
        accept: itemType,
        get disabled() {
            return !enabled()
        },
        data: {item: undefined, handler: ((src: T) => handler(src)) as unknown as (src: never, dst: never) => void},
    })

    return [isDropTarget, makeAttachRef(ref)]
}

export function useSortable<T>(itemType: string, item: () => T, enabled: () => boolean, handler: (src: T, dst: T) => void): [Accessor<boolean>, Accessor<boolean>, AttachRef] {
    const {isDragging, isOver, ref} = useSortableBase(itemType, item, enabled, handler)
    return [isDragging, isOver, ref]
}

export function useSortableWithGrip(itemType: string, item: () => ISortableWithGripItem, enabled: () => boolean, handler: (src: IContentBlockWithCords, dst: IContentBlockWithCords) => void): [Accessor<boolean>, Accessor<boolean>, AttachRef, AttachRef] {
    const {isDragging, isOver, ref, handleRef} = useSortableBase(itemType, item as () => IContentBlockWithCords, enabled, handler)

    // The grip is the drag handle and the wrapper is both the dragged element
    // and the drop target -- the same split react-dnd wrote as drag(ref) and
    // drop(preview(previewRef)).
    return [isDragging, isOver, handleRef, ref]
}
