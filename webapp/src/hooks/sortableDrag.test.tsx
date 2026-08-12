import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'
import {render} from '@solidjs/testing-library'
import {useDragDropManager} from '@dnd-kit/solid'

import {setupDragEnvironment, setRect, drag, flick} from '../test/dragEnvironment'

import {SortableProvider, useSortable, useDropZone} from './sortable'

setupDragEnvironment()

// Solid needs no act(): events propagate synchronously. The helpers still take
// a wrapper so the same code serves suites that need one; this is it.
const act = async (fn: () => Promise<void>): Promise<unknown> => fn()

type Item = {id: string}

function Card(props: {item: Item, onDrop: (src: Item, dst: Item) => void}) {
    const [, , ref] = useSortable('card', () => props.item, () => true, (src: Item, dst: Item) => props.onDrop(src, dst))
    return (
        <div
            ref={ref}
            data-testid={props.item.id}
        />
    )
}

function Zone(props: {onDrop: (src: Item) => void}) {
    const [, ref] = useDropZone<Item>('card', () => true, (src) => props.onDrop(src))
    return (
        <div
            ref={ref}
            data-testid='zone'
        />
    )
}

describe('hooks/sortable dragging', () => {
    const a = {id: 'a'}
    const b = {id: 'b'}

    function setup() {
        const onCard = vi.fn()
        const onZone = vi.fn()
        const {getByTestId} = render(() => (
            <SortableProvider>
                <Card
                    item={a}
                    onDrop={onCard}
                />
                <Card
                    item={b}
                    onDrop={onCard}
                />
                <Zone onDrop={onZone}/>
            </SortableProvider>
        ))
        setRect(getByTestId('a'), {x: 0, y: 0, width: 100, height: 40})
        setRect(getByTestId('b'), {x: 0, y: 100, width: 100, height: 40})
        setRect(getByTestId('zone'), {x: 0, y: 200, width: 100, height: 100})
        return {getByTestId, onCard, onZone}
    }

    it('drops a card onto another card', async () => {
        const {getByTestId, onCard} = setup()

        await drag(act, getByTestId('a'), {x: 50, y: 120})

        expect(onCard).toHaveBeenCalledWith(a, b)
    })

    it('drops a card into a zone that holds none', async () => {
        const {getByTestId, onZone} = setup()

        await drag(act, getByTestId('a'), {x: 50, y: 250})

        expect(onZone).toHaveBeenCalledWith(a)
    })

    // Note this passes with dnd-kit's defaults too: the abort it guards against
    // hangs off a real 200ms timer that jsdom does not reproduce. It is here for
    // what it does assert -- that a single-move drag lands -- not as a guard.
    //
    // Moving the mouse quickly is not a mistake the user made. dnd-kit's default
    // pairs a Delay with a Distance under one controller, and the Delay aborts
    // the whole activation if the pointer outruns its tolerance before the timer
    // fires -- so a flick produces a beforedragstart, a canceled dragend, and no
    // drag. Whether dragging worked came down to how fast the hand moved.
    it('drops when the pointer is moved in one quick sweep', async () => {
        const {getByTestId, onZone} = setup()

        await flick(act, getByTestId('a'), {x: 50, y: 250})

        expect(onZone).toHaveBeenCalledWith(a)
    })

    // Dropping a card moves it, which unmounts the element that was being
    // dragged. dnd-kit resets a finished operation only once that element
    // reports itself idle at the end of its drop animation -- so an element that
    // leaves mid-animation leaves the manager believing a drag is still running,
    // and every press after it is ignored. Two drags in a row is the whole test.
    it('still works after the dragged card has gone away', async () => {
        const onCard = vi.fn()
        const onZone = vi.fn()

        function Board(props: {probe: JSX.Element}) {
            const [gone, setGone] = createSignal(false)
            return (
                <SortableProvider>
                    {props.probe}
                    <Show when={!gone()}>
                        <Card
                            item={a}
                            onDrop={(src, dst) => {
                                onCard(src, dst)
                                setGone(true)
                            }}
                        />
                    </Show>
                    <Card
                        item={b}
                        onDrop={onCard}
                    />
                    <Zone onDrop={onZone}/>
                </SortableProvider>
            )
        }

        let manager: {dragOperation: {status: {idle: boolean}}} | null = null

        function Probe() {
            manager = useDragDropManager() as never
            return null
        }

        const {getByTestId} = render(() => <Board probe={<Probe/>}/>)
        setRect(getByTestId('a'), {x: 0, y: 0, width: 100, height: 40})
        setRect(getByTestId('b'), {x: 0, y: 100, width: 100, height: 40})
        setRect(getByTestId('zone'), {x: 0, y: 200, width: 100, height: 100})

        await drag(act, getByTestId('a'), {x: 50, y: 120})
        expect(onCard).toHaveBeenCalledWith(a, b)

        // The second drag is only half of it. dnd-kit refuses a press outright
        // unless the operation is idle, and refuses it in silence, so a board
        // that never got back to idle looks like a board nobody pressed. Say
        // which of the two failed.
        expect(manager!.dragOperation.status.idle).toBe(true)

        await drag(act, getByTestId('b'), {x: 50, y: 250})
        expect(onZone).toHaveBeenCalledWith(b)
    })

    // The card being dragged is a drop target too, and it follows the pointer,
    // so without care it wins every collision and the drop is discarded as a
    // drop onto itself -- which is exactly how dragging stopped working.
    it('never lands on the card being dragged', async () => {
        const {getByTestId, onCard} = setup()

        await drag(act, getByTestId('a'), {x: 50, y: 20})

        expect(onCard).not.toHaveBeenCalled()
    })
})
