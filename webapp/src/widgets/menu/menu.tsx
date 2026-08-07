// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, children} from 'solid-js'
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
import MenuUtil, {AnchorRef} from './menuUtil'

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

    return (
        <div
            class={`Menu noselect ${props.position || 'bottom'} ${props.fixed ? ' fixed' : ''}`}
            style={style()}
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
