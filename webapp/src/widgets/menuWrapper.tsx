import {Show, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {menuOptions} from './menu/menuUtil'

import './menuWrapper.scss'

type Props = {

    // Under React the wrapper took exactly two children and rendered the
    // second only while open. In Solid resolving children builds them, so the
    // menu is its own prop: JSX in prop position compiles to a getter, and a
    // getter read behind Show is a menu built on open and torn down on close.
    menu: JSX.Element
    stopPropagationOnToggle?: boolean
    class?: string
    disabled?: boolean
    isOpen?: boolean
    onToggle?: (open: boolean) => void
    label?: string
}

const MenuWrapper: ParentComponent<Props> = (props) => {
    let node: HTMLDivElement | undefined
    const [open, setOpen] = createSignal(Boolean(props.isOpen))

    // Whatever opens the menu is where the keyboard goes back to when it
    // closes: the menu takes focus while it is open, and the option that had it
    // is gone by the time it closes. Without this the person is returned to the
    // top of the page having chosen one thing from one menu.
    const restoreFocus = (): void => {
        const active = document.activeElement
        if (!node || (active !== document.body && !node.contains(active))) {
            return // focus went somewhere on purpose; leave it there
        }
        const trigger = [...node.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')].
            find((el) => !el.closest('.Menu'))
        trigger?.focus()
    }

    const close = (): void => {
        if (open()) {
            setOpen(false)
            props.onToggle && props.onToggle(false)
            restoreFocus()
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
        if (!next) {
            restoreFocus()
        }
    }

    // Down or up opens the menu and steps into it, as a native dropdown does.
    // Enter and space need nothing: what stands in here is a button, and a
    // button turns them into the click above.
    //
    // This is also the only thing that moves focus into a menu. Opening one
    // does not — a menu often stands inside something that is editing and
    // closes the moment focus leaves it — so the keyboard goes in when it is
    // asked for and not before. Once inside, the menu itself does the walking.
    const onKeyDown = (e: KeyboardEvent): void => {
        if (props.disabled || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) {
            return
        }
        if (open() && node?.querySelector('.Menu')?.contains(document.activeElement)) {
            return // already inside; the menu moves between its own options
        }
        e.preventDefault()
        if (!open()) {
            setOpen(true)
            props.onToggle && props.onToggle(true)
        }

        // Solid renders the menu as part of the write above, so the options are
        // already there and the step happens in the same turn as the key. The
        // second try is for a menu whose options an effect of its own builds.
        const stepIn = (): boolean => {
            const options = menuOptions(node?.querySelector<HTMLElement>('.Menu') || undefined)
            const step = e.key === 'ArrowDown' ? options[0] : options[options.length - 1]
            step?.focus()
            return options.length > 0
        }
        if (!stepIn()) {
            queueMicrotask(stepIn)
        }
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

    const classes = () => {
        let name = 'MenuWrapper'
        if (props.disabled) {
            name += ' disabled'
        }
        if (open()) {
            name += ' override menuOpened'
        }
        if (props.class) {
            name += ' ' + props.class
        }
        return name
    }

    return (
        <div
            role='button'
            aria-label={props.label || 'menuwrapper'}
            class={classes()}
            onClick={toggle}
            onKeyDown={onKeyDown}
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
