import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'

import Tooltip from './tooltip'

function layOutAt(rect: {top: number, left: number, width: number, height: number}): void {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        ...rect,
        bottom: rect.top + rect.height,
        right: rect.left + rect.width,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
    } as DOMRect)
}

const hover = () => {
    render(() => (
        <Tooltip title='Оценка, часы'>
            <span>{'8'}</span>
        </Tooltip>
    ))
    const host = screen.getByText('8').parentElement as HTMLElement
    fireEvent.mouseEnter(host)
    return host
}

afterEach(() => {
    vi.restoreAllMocks()
})

// The bubble used to be a `::after` on the wrapper, so it was drawn inside
// whatever the wrapper stood in — on a kanban card, the card, whose column
// scrollbox was then free to clip it.
describe('a tooltip on the page', () => {
    // Nothing is said until somebody is looking at the thing: a bubble that is
    // always in the DOM is a bubble that is always in the way.
    it('appears while the pointer is on what it names', () => {
        const host = hover()
        expect(screen.getByRole('tooltip')).toHaveTextContent('Оценка, часы')

        fireEvent.mouseLeave(host)
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('is placed against the viewport, clear of what it names', async () => {
        layOutAt({top: 300, left: 400, width: 40, height: 20})
        hover()

        const bubble = screen.getByRole('tooltip')
        await waitFor(() => expect(bubble.classList.contains('is-positioned')).toBe(true))
        expect(bubble.style.transform).toMatch(/^translate\(-?\d+px, -?\d+px\)$/)
    })

    // Guessing the origin would put every tooltip in the corner of the screen.
    it('stays where the stylesheet put it when nothing has been laid out', async () => {
        hover()

        const bubble = screen.getByRole('tooltip')
        await Promise.resolve()
        expect(bubble.classList.contains('is-positioned')).toBe(false)
    })
})
