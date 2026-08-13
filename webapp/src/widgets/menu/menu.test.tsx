import {fireEvent, render, screen, waitFor} from '@solidjs/testing-library'

import {mockMatchMedia, wrapIntl} from '../../testUtils'
import MenuWrapper from '../menuWrapper'

import Menu from './menu'

// jsdom lays nothing out, and a menu that cannot measure its anchor leaves
// itself where the stylesheet put it. Standing a box behind every element is
// what makes the placement observable at all.
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

const openMenu = () => {
    render(() => wrapIntl(() => (
        <MenuWrapper
            menu={
                <Menu>
                    <Menu.Text
                        id='delete'
                        name='Удалить'
                        onClick={() => {}}
                    />
                </Menu>
            }
        >
            <button>{'⋯'}</button>
        </MenuWrapper>
    )))
    fireEvent.click(screen.getByText('⋯'))
    return document.querySelector('.Menu') as HTMLElement
}

beforeEach(() => {
    mockMatchMedia({matches: false})
})

afterEach(() => {
    vi.restoreAllMocks()
})

// The board scrolls inside `.Kanban` and the frame around it clips what
// overflows, so a menu that is part of the page is cut off by both — which on
// a card in the left column looked like the menu sliding under the sidebar. A
// menu is placed against the viewport instead, and it learns where from the
// control it was opened from.
describe('a menu opened from a control', () => {
    it('stands against the viewport rather than inside the page', async () => {
        layOutAt({top: 100, left: 240, width: 24, height: 24})
        const menu = openMenu()

        // The coordinates are floating-ui's and it is tested on its own; what
        // matters here is that the menu was handed to it at all, and so is
        // drawn against the viewport rather than inside the board's scrollbox.
        await waitFor(() => expect(menu.classList.contains('floating')).toBe(true))
        expect(menu.style.transform).toMatch(/^translate\(-?\d+px, -?\d+px\)$/)
    })

    // Nothing to measure means nothing is known, and guessing the origin puts
    // every menu in the top-left corner of the screen.
    it('is left where the stylesheet put it when nothing has been laid out', async () => {
        const menu = openMenu()

        await Promise.resolve()
        expect(menu.classList.contains('floating')).toBe(false)
        expect(menu.style.transform).toBe('')
    })
})
