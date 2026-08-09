// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'
import CompassIcon from '../../widgets/icons/compassIcon'

import MenuUtil from './menuUtil'

import TextOption from './textOption'

import './subMenuOption.scss'

type SubMenuOptionProps = {
    id: string
    name: string
    position?: 'bottom' | 'top' | 'left' | 'left-bottom' | 'auto'
    icon?: JSX.Element
    children: JSX.Element
    class?: string
}

function SubMenuOption(props: SubMenuOptionProps): JSX.Element {
    const intl = useIntl()
    const [isOpen, setIsOpen] = createSignal(false)

    const openLeftClass = () => (props.position === 'left' || props.position === 'left-bottom' ? ' open-left' : '')

    let ref: HTMLDivElement | undefined

    const [style, setStyle] = createSignal<JSX.CSSProperties>({})

    onMount(() => {
        const newStyle: JSX.CSSProperties = {}
        if (props.position === 'auto' && ref) {
            const openUp = MenuUtil.openUp({current: ref})
            if (openUp.openUp) {
                newStyle.bottom = '0'
            } else {
                newStyle.top = '0'
            }
        }

        setStyle(newStyle)
    })

    return (
        <div
            id={props.id}
            class={`MenuOption SubMenuOption menu-option${openLeftClass()}${isOpen() ? ' menu-option-active' : ''}${props.class ? ' ' + props.class : ''}`}

            // The submenu is drawn inside this option and flush against it, so
            // the pointer never leaves on its way in: entering opens it, and
            // leaving — for the option below, or off the menu — closes it.
            onMouseEnter={() => setIsOpen(true)}
            onMouseLeave={() => setIsOpen(false)}

            // A tap opens it too, because a phone has no pointer to hover with
            // and this menu is on the phone as well. It opens rather than
            // toggles: with a pointer the entering already opened it, and a
            // click that closed what hovering had just opened is what a person
            // does the moment they decide to click the thing they are pointing
            // at. Closing is leaving it, or closing the menu around it.
            onClick={(e: MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                setIsOpen(true)
            }}
            ref={ref}
        >
            <Show
                when={props.icon}
                fallback={<div class='noicon'/>}
            >
                <div class='menu-option__icon'>{props.icon}</div>
            </Show>
            <div class='menu-name'>{props.name}</div>
            <CompassIcon icon='chevron-right'/>
            <Show when={isOpen()}>
                <div
                    class={'SubMenu Menu noselect ' + (props.position || 'bottom')}
                    style={style()}
                >
                    <div class='menu-contents'>
                        <div class='menu-options'>
                            {props.children}
                        </div>
                        <div class='menu-spacer hideOnWidescreen'/>

                        <div class='menu-options hideOnWidescreen'>
                            <TextOption
                                id='menu-cancel'
                                name={intl.formatMessage({id: 'Menu.cancel', defaultMessage: 'Cancel'})}
                                class='menu-cancel'
                                onClick={() => undefined}
                            />
                        </div>
                    </div>

                </div>
            </Show>
        </div>
    )
}

export default SubMenuOption
