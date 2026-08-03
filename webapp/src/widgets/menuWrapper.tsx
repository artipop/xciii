// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import './menuWrapper.scss'

type Props = {
    // Under React the wrapper took exactly two children and rendered the
    // second only while open. In Solid resolving children builds them, so the
    // menu is its own prop: JSX in prop position compiles to a getter, and a
    // getter read behind Show is a menu built on open and torn down on close.
    menu: JSX.Element
    stopPropagationOnToggle?: boolean
    className?: string
    disabled?: boolean
    isOpen?: boolean
    onToggle?: (open: boolean) => void
    label?: string
}

const MenuWrapper: ParentComponent<Props> = (props) => {
    let node: HTMLDivElement | undefined
    const [open, setOpen] = createSignal(Boolean(props.isOpen))

    const close = (): void => {
        if (open()) {
            setOpen(false)
            props.onToggle && props.onToggle(false)
        }
    }

    const closeOnBlur = (e: Event) => {
        if (e.target && node?.contains(e.target as Node)) {
            return
        }

        close()
    }

    const keyboardClose = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            close()
        }

        if (e.key === 'Tab') {
            closeOnBlur(e)
        }
    }

    const toggle = (e: MouseEvent): void => {
        if (props.disabled) {
            return
        }

        /**
         * This is only here so that we can toggle the menus in the sidebar, because the default behavior of the mobile
         * version (ie the one that uses a modal) needs propagation to close the modal after selecting something
         * We need to refactor this so that the modal is explicitly closed on toggle, but for now I am aiming to preserve the existing logic
         * so as to not break other things
        **/
        if (props.stopPropagationOnToggle) {
            e.preventDefault()
            e.stopPropagation()
        }
        const next = !open()
        setOpen(next)
        props.onToggle && props.onToggle(next)
    }

    createEffect(() => {
        if (open()) {
            document.addEventListener('menuItemClicked', close, true)
            document.addEventListener('click', closeOnBlur, true)
            document.addEventListener('keyup', keyboardClose, true)
            onCleanup(() => {
                document.removeEventListener('menuItemClicked', close, true)
                document.removeEventListener('click', closeOnBlur, true)
                document.removeEventListener('keyup', keyboardClose, true)
            })
        }
    })

    const className = () => {
        let name = 'MenuWrapper'
        if (props.disabled) {
            name += ' disabled'
        }
        if (open()) {
            name += ' override menuOpened'
        }
        if (props.className) {
            name += ' ' + props.className
        }
        return name
    }

    return (
        <div
            role='button'
            aria-label={props.label || 'menuwrapper'}
            class={className()}
            onClick={toggle}
            ref={node}
        >
            {props.children}
            <Show when={!props.disabled && open()}>
                {props.menu}
            </Show>
        </div>
    )
}

export default MenuWrapper
