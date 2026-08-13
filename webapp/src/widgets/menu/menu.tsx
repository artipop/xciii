import {For, children, createEffect, createSignal, onCleanup} from 'solid-js'
import {autoUpdate, computePosition, flip, shift} from '@floating-ui/dom'
import type {Component, JSX} from 'solid-js'

import {useIntl} from '../../intl'

import SeparatorOption from './separatorOption'
import SwitchOption from './switchOption'
import TextOption from './textOption'
import ColorOption from './colorOption'
import SubMenuOption from './subMenuOption'
import LabelOption from './labelOption'

import './menu.scss'
import textInputOption from './textInputOption'
import {AnchorRef, MenuPlacement, floatingPlacement, menuOptions, useMenuAnchor} from './menuUtil'

// How close to the edge of the screen a menu is allowed to get.
const VIEWPORT_PADDING = 8

type Props = {
    children: JSX.Element
    position?: MenuPlacement
    parentRef?: AnchorRef
}

// A submenu opens itself on hover (subMenuOption.tsx). It used to be told to,
// through a context this menu provided around every option — which never once
// reached it: children() resolves the options before the provider exists, so
// each of them was created outside it and read the default, false. Nothing
// opened on hover, and nothing closed on leaving.
const Menu: Component<Props> & {
    Color: typeof ColorOption
    SubMenu: typeof SubMenuOption
    Switch: typeof SwitchOption
    Separator: typeof SeparatorOption
    Text: typeof TextOption
    TextInput: typeof textInputOption
    Label: typeof LabelOption
} = (props: Props) => {
    const intl = useIntl()
    const resolved = children(() => props.children)
    const wrapperAnchor = useMenuAnchor()

    const onCancel = () => {
        // No need to do anything, as click bubbled up to MenuWrapper, which closes
    }

    // A menu is walked with the arrow keys, which is the only way to reach it
    // without a pointer: an option is a div with a role, not a button, so it is
    // neither in the tab order nor activated by Enter on its own. Focus moves
    // between the options and Tab leaves the menu entirely — the ARIA menu
    // pattern, and the same thing a native dropdown does.
    //
    // Opening the menu does not move focus, and that is deliberate: a menu
    // often stands inside something that is editing — a property value, a card
    // title — and that something closes when focus leaves it. The keyboard is
    // taken in by the arrow key that asks for it (menuWrapper.tsx), not by the
    // menu appearing.
    let root: HTMLDivElement | undefined
    const [placed, setPlaced] = createSignal<{x: number, y: number} | null>(null)

    // Focusable, but none of them tabbable: tabbing out is how a menu is left.
    createEffect(() => {
        resolved()
        for (const option of menuOptions(root)) {
            option.setAttribute('tabindex', '-1')
        }
    })

    // A menu is placed against the viewport rather than positioned inside the
    // page, and that is the whole of the fix: it used to be an absolutely
    // positioned child of the wrapper it opened from, so `.Kanban`'s scrollbox
    // and `.mainFrame`'s `overflow: hidden` each clipped it — a card's ⋯ menu
    // in the left column was cut off at the frame's edge and read as sliding
    // under the sidebar.
    //
    // @floating-ui/dom does the placing, as it already does for the combobox,
    // the typeahead and both tour tips: `flip` turns the menu to the side with
    // room, `shift` keeps it on screen, and `autoUpdate` follows the anchor
    // when the column under it scrolls. The wrapper is the anchor unless a
    // caller names another element — sidebarBoardItem hangs its menu off the
    // whole row rather than off the ⋯ it was pressed on.
    createEffect(() => {
        const anchor = props.parentRef?.current || wrapperAnchor()
        if (!anchor || !root) {
            return
        }

        // Below 430px a menu is a sheet covering the screen (menu.scss), with
        // nothing to anchor to and nothing to keep on screen.
        if (window.matchMedia?.('(max-width: 430px)').matches) {
            return
        }

        const floating = root
        const stop = autoUpdate(anchor, floating, () => {
            // An anchor with no box is one nothing has laid out — jsdom, or a
            // wrapper off screen. Placing against it would put the menu in the
            // corner of the screen rather than leave it where the stylesheet
            // did.
            const box = anchor.getBoundingClientRect()
            if (box.width === 0 && box.height === 0) {
                return
            }
            computePosition(anchor, floating, {
                strategy: 'fixed',
                placement: floatingPlacement(props.position),
                middleware: [flip(), shift({padding: VIEWPORT_PADDING})],
            }).then(({x, y}) => setPlaced({x, y}))
        })
        onCleanup(() => {
            stop()
            setPlaced(null)
        })
    })

    const onKeyDown = (e: KeyboardEvent) => {
        const options = menuOptions(root)
        if (options.length === 0) {
            return
        }
        const at = options.indexOf(document.activeElement as HTMLElement)
        const moveTo = (next: number) => {
            e.preventDefault()
            options[(next + options.length) % options.length].focus()
        }

        switch (e.key) {
        case 'ArrowDown':
            moveTo(at + 1)
            break
        case 'ArrowUp':
            // Nothing focused yet means the walk starts at the end, which is
            // what somebody reaching upwards is asking for.
            moveTo(at <= 0 ? options.length - 1 : at - 1)
            break
        case 'Home':
            moveTo(0)
            break
        case 'End':
            moveTo(options.length - 1)
            break
        case 'Enter':
        case ' ':
            if (at >= 0) {
                e.preventDefault()
                options[at].click()
            }
            break
        default:
        }
    }

    return (
        <div
            ref={root}
            class={`Menu noselect ${props.position || 'bottom'}${placed() ? ' floating' : ''}`}
            style={placed() ? {transform: `translate(${Math.round(placed()!.x)}px, ${Math.round(placed()!.y)}px)`} : undefined}
            onKeyDown={onKeyDown}
        >
            <div class='menu-contents'>
                <div class='menu-options'>
                    <For each={resolved.toArray()}>
                        {(child) => child}
                    </For>
                </div>

                <div class='menu-spacer hideOnWidescreen'/>

                <div class='menu-options hideOnWidescreen'>
                    <TextOption
                        id='menu-cancel'
                        name={intl.formatMessage({id: 'Menu.cancel', defaultMessage: 'Cancel'})}
                        class='menu-cancel'
                        onClick={onCancel}
                    />
                </div>
            </div>
        </div>
    )
}

Menu.Color = ColorOption
Menu.SubMenu = SubMenuOption
Menu.Switch = SwitchOption
Menu.Separator = SeparatorOption
Menu.Text = TextOption
Menu.TextInput = textInputOption
Menu.Label = LabelOption

export default Menu
