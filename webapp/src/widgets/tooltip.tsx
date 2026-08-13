import {Show, createEffect, createSignal, onCleanup} from 'solid-js'
import {arrow, autoUpdate, computePosition, flip, offset, shift, type Placement} from '@floating-ui/dom'
import type {JSX} from 'solid-js'

import './tooltip.scss'

// How far the bubble stands off the thing it names, and how close to the edge
// of the screen it is allowed to get.
const TOOLTIP_OFFSET = 8
const VIEWPORT_PADDING = 8

// Which edge of the bubble the arrow stands on, given the side it ended up on.
const ARROW_SIDE: Record<string, string> = {top: 'bottom', bottom: 'top', left: 'right', right: 'left'}

type Props = {
    title: string
    children: JSX.Element
    placement?: 'top'|'left'|'right'|'bottom'
}

// Adds a tooltip over its children, shown while the pointer or the keyboard is
// on them.
//
// It used to be a `::after` on the wrapper, positioned by the stylesheet — and
// a `::after` is placed inside whatever the wrapper stands in, which on a
// kanban card is the card. `.Kanban` scrolls and `.mainFrame` hides its
// overflow, so the bubble was theirs to clip as well.
//
// It is `@floating-ui/dom` with the fixed strategy now, which is what the
// combobox, the typeahead and both tour tips already use: nothing an ancestor
// does with overflow can clip a fixed box, `flip` turns the bubble to the side
// with room instead of letting it hang off the screen, `shift` keeps it on
// screen, and `autoUpdate` follows the anchor when the page scrolls under a
// resting pointer.
function Tooltip(props: Props): JSX.Element {
    const [shown, setShown] = createSignal(false)
    const [bubble, setBubble] = createSignal<HTMLDivElement | null>(null)
    const [point, setPoint] = createSignal<HTMLDivElement | null>(null)
    const [at, setAt] = createSignal<{x: number, y: number, arrowX?: number, arrowY?: number, side: string} | null>(null)
    let host: HTMLDivElement | undefined

    createEffect(() => {
        const floating = bubble()
        const arrowEl = point()
        if (!host || !floating || !arrowEl) {
            return
        }

        // An anchor with no box is one nothing has laid out — jsdom, or a
        // wrapper off screen. Placing against it would put the bubble in the
        // corner of the screen rather than leave it where the stylesheet did.
        const reference = host
        const stop = autoUpdate(reference, floating, () => {
            const box = reference.getBoundingClientRect()
            if (box.width === 0 && box.height === 0) {
                return
            }
            computePosition(reference, floating, {
                strategy: 'fixed',
                placement: (props.placement || 'top') as Placement,
                middleware: [
                    offset(TOOLTIP_OFFSET),
                    flip(),
                    shift({padding: VIEWPORT_PADDING}),
                    arrow({element: arrowEl, padding: VIEWPORT_PADDING}),
                ],
            }).then((computed) => setAt({
                x: computed.x,
                y: computed.y,
                arrowX: computed.middlewareData.arrow?.x,
                arrowY: computed.middlewareData.arrow?.y,
                side: computed.placement.split('-')[0],
            }))
        })
        onCleanup(() => {
            stop()
            setAt(null)
        })
    })

    // Focus says the tooltip too, for somebody reaching it with the keyboard —
    // and only for them. In most browsers a click focuses the button as well,
    // and a label left standing over the thing that was just pressed is noise;
    // :focus-visible is the browser's own answer to which kind of focus it was.
    const onFocusIn = (e: FocusEvent) => {
        const target = e.target as HTMLElement | null
        if (target?.matches?.(':focus-visible')) {
            setShown(true)
        }
    }

    const bubbleStyle = (): JSX.CSSProperties | undefined => {
        const placed = at()
        return placed ? {transform: `translate(${Math.round(placed.x)}px, ${Math.round(placed.y)}px)`} : undefined
    }

    // The arrow stays on the anchor even when `shift` had to pull the bubble
    // back from the edge of the screen: floating-ui gives its offset along the
    // bubble, and the side it stands on is the opposite of where the bubble
    // ended up.
    const arrowStyle = (): JSX.CSSProperties | undefined => {
        const placed = at()
        if (!placed) {
            return undefined
        }
        return {
            left: placed.arrowX === undefined ? undefined : `${placed.arrowX}px`,
            top: placed.arrowY === undefined ? undefined : `${placed.arrowY}px`,
            [ARROW_SIDE[placed.side] || 'bottom']: '-4px',
        }
    }

    return (
        <div
            ref={host}
            class='octo-tooltip'
            onMouseEnter={() => setShown(true)}
            onMouseLeave={() => setShown(false)}
            onFocusIn={onFocusIn}
            onFocusOut={() => setShown(false)}
        >
            {props.children}
            <Show when={shown() && props.title}>
                <div
                    ref={setBubble}
                    class={`octo-tooltip__body${at() ? ' is-positioned' : ''}`}
                    style={bubbleStyle()}
                    role='tooltip'
                >
                    <span class='octo-tooltip__text'>{props.title}</span>
                    <div
                        ref={setPoint}
                        class='octo-tooltip__arrow'
                        style={arrowStyle()}
                    />
                </div>
            </Show>
        </div>
    )
}

export default Tooltip
