// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createContext, createEffect, createSignal, onMount, useContext} from 'solid-js'
import type {Accessor, JSX} from 'solid-js'

import {useIntl} from '../../intl'
import CompassIcon from '../../widgets/icons/compassIcon'

import MenuUtil from './menuUtil'

import TextOption from './textOption'

import './subMenuOption.scss'

// The value is an accessor: the menu wraps every option and flips this when
// the pointer moves between wrappers.
export const HoveringContext = createContext<Accessor<boolean>>(() => false)

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
    const isHovering = useContext(HoveringContext)

    const openLeftClass = () => (props.position === 'left' || props.position === 'left-bottom' ? ' open-left' : '')

    createEffect(() => {
        setIsOpen(isHovering())
    })

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
            onClick={(e: MouseEvent) => {
                e.preventDefault()
                e.stopPropagation()
                setIsOpen((open) => !open)
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
