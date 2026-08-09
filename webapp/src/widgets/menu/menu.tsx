// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, children, createEffect} from 'solid-js'
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
import MenuUtil, {AnchorRef, menuOptions} from './menuUtil'

type Props = {
    children: JSX.Element
    position?: 'top' | 'bottom' | 'left' | 'right' | 'auto'
    fixed?: boolean
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

    // Position against the anchor is measured when the menu opens — creation
    // time — exactly when the class component measured in render.
    const style = (): JSX.CSSProperties => {
        if (props.parentRef) {
            const forceBottom = props.position ? ['bottom', 'left', 'right'].includes(props.position) : false
            return MenuUtil.openUp(props.parentRef, forceBottom).style
        }
        return {}
    }

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

    // Focusable, but none of them tabbable: tabbing out is how a menu is left.
    createEffect(() => {
        resolved()
        for (const option of menuOptions(root)) {
            option.setAttribute('tabindex', '-1')
        }
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
            class={`Menu noselect ${props.position || 'bottom'} ${props.fixed ? ' fixed' : ''}`}
            style={style()}
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
