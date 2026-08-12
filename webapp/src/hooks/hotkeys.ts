import {onCleanup, onMount} from 'solid-js'

import {bindHotkey, type HotkeyHandler} from '../hotkeys'

// The Solid half of `hotkeys.ts`, and all of it. The handler closure sees the
// component's live signals, so nothing needs re-binding — the ref dance the
// React version did to keep the handler current is simply how closures work
// under fine-grained reactivity.
export function useHotkeys(shortcut: string, handler: HotkeyHandler): void {
    onMount(() => {
        onCleanup(bindHotkey(shortcut, (event) => handler(event)))
    })
}
