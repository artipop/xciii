import {render, screen, fireEvent} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import Menu from './menu'

const submenu = () => (
    <Menu>
        <Menu.SubMenu
            id='theme'
            name='Theme'
        >
            <Menu.Text
                id='dark'
                name='Dark theme'
                onClick={() => undefined}
            />
        </Menu.SubMenu>
        <Menu.Text
            id='other'
            name='Something else'
            onClick={() => undefined}
        />
    </Menu>
)

describe('widgets/menu/subMenuOption', () => {
    // The way a menu is used: the pointer runs down it and each submenu opens
    // as it is passed. This was broken for a while and read as the menu being
    // dead — a submenu that only answers a click looks like one that is stuck.
    it('opens when the pointer arrives and closes when it leaves', () => {
        render(() => wrapIntl(submenu))

        const option = document.getElementById('theme') as HTMLElement
        expect(screen.queryByText('Dark theme')).not.toBeInTheDocument()

        fireEvent.mouseEnter(option)
        expect(screen.getByText('Dark theme')).toBeInTheDocument()

        fireEvent.mouseLeave(option)
        expect(screen.queryByText('Dark theme')).not.toBeInTheDocument()
    })

    // A phone has no pointer to hover with, and this menu is on the phone too.
    // A click opens rather than toggles: with a pointer, hovering has already
    // opened it, and clicking the thing you are pointing at must not shut it.
    it('also opens on a click, and a second one leaves it open', () => {
        render(() => wrapIntl(submenu))

        const option = document.getElementById('theme') as HTMLElement
        fireEvent.click(option)
        expect(screen.getByText('Dark theme')).toBeInTheDocument()

        fireEvent.click(option)
        expect(screen.getByText('Dark theme')).toBeInTheDocument()
    })
})
