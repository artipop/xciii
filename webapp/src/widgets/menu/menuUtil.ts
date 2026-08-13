import {createContext, useContext} from 'solid-js'
import type {Placement} from '@floating-ui/dom'

// The ref shape the React version took from useRef; callers hand in
// {current: element} so the calculation stays framework-free.
export type AnchorRef = {current: HTMLElement | null}

export type MenuPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto'

// This menu's own vocabulary, which is not floating-ui's. `left` never named
// the side the menu opens on — it was `right: 0` against the wrapper, meaning
// the menu lines its right edge up with the anchor's, which is `-end` here.
// And `auto` asked for whichever side had room, which is what `flip` does to
// any placement, so it is `bottom-start` like the default.
const PLACEMENTS: Record<MenuPlacement, Placement> = {
    top: 'top-start',
    bottom: 'bottom-start',
    right: 'bottom-start',
    left: 'bottom-end',
    auto: 'bottom-start',
}

export function floatingPlacement(position?: MenuPlacement): Placement {
    return PLACEMENTS[position || 'bottom'] || 'bottom-start'
}

// The element a menu was opened from, handed down rather than passed in. A
// menu is written as JSX in MenuWrapper's `menu` prop at forty-odd call sites,
// and none of them should have to learn that placing one needs a measurement.
const MenuAnchorContext = createContext<() => HTMLElement | undefined>(() => undefined)

export const MenuAnchorProvider = MenuAnchorContext.Provider

export function useMenuAnchor(): () => HTMLElement | undefined {
    return useContext(MenuAnchorContext)
}

// The options a keyboard walks, in the order they are on screen: the ones a
// click does something to. A heading, a separator, a text box and the phone's
// own «Cancel» are not steps on that walk, and neither is anything inside a
// submenu — that menu walks itself.
//
// Lives here because both halves need it and neither owns it: the menu moves
// between them, and the wrapper around it is what puts the keyboard inside in
// the first place.
export function menuOptions(root: HTMLElement | undefined): HTMLElement[] {
    if (!root) {
        return []
    }
    return [...root.querySelectorAll<HTMLElement>('.menu-options > .menu-option')].filter((option) =>
        !option.closest('.SubMenu') &&
        !option.classList.contains('LabelOption') &&
        !option.classList.contains('menu-textbox') &&
        !option.classList.contains('menu-cancel') &&
        !option.classList.contains('menu-option--disabled'))
}

