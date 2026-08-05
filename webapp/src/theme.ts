// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {UserSettings} from './userSettings'

// The palette itself lives in `styles/_tokens.scss`, both themes side by side.
// This module only decides *which* of them applies, by putting a `data-theme`
// attribute on the document element.
//
// It used to write every colour out with `setProperty`, which is why the
// palette had two sources that disagreed — the SCSS `:root` block said one
// thing and this file said another, and this file won. Adding a token meant
// adding a thirty-first `setProperty` call, so the two drifted. Now there is
// one source, and switching a theme is one attribute.

export const lightThemeName = 'light-theme'
export const darkThemeName = 'dark-theme'
export const systemThemeName = 'system-theme'

// The board used to ship a fourth theme, `default-theme`, that differed from
// `light-theme` only in the colour of the sidebar. It is gone, and the name
// stays as an alias so a stored setting naming it still resolves.
export const defaultThemeName = lightThemeName

export type ThemeName = typeof lightThemeName | typeof darkThemeName | typeof systemThemeName

const themeNames: string[] = [lightThemeName, darkThemeName, systemThemeName]

let activeThemeName: ThemeName = systemThemeName

function prefersDark(): boolean {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// `system` is not a third palette: it resolves to one of the two at paint time.
function apply(name: ThemeName) {
    const dark = name === darkThemeName || (name === systemThemeName && prefersDark())
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setTheme(name: ThemeName): ThemeName {
    activeThemeName = name
    UserSettings.theme = name
    apply(name)
    return name
}

export function getActiveThemeName(): ThemeName {
    return activeThemeName
}

// What is stored is the *name* of a theme. It used to be a JSON snapshot of
// every colour, which would now be a blob of dead Mattermost values laid inline
// over the tokens — so anything that is not one of our three names, including
// every setting written before this change, is read as `system`.
export function loadTheme(): ThemeName {
    const stored = UserSettings.theme
    const name = stored && themeNames.includes(stored) ? stored as ThemeName : systemThemeName
    activeThemeName = name
    apply(name)
    return name
}

export function initThemes(): void {
    const darkThemeMq = window.matchMedia('(prefers-color-scheme: dark)')
    const changeHandler = () => {
        if (activeThemeName === systemThemeName) {
            apply(systemThemeName)
        }
    }
    if (darkThemeMq.addEventListener) {
        darkThemeMq.addEventListener('change', changeHandler)
    } else if (darkThemeMq.addListener) {
        // Safari and Mac app support
        darkThemeMq.addListener(changeHandler)
    }
    loadTheme()
}

// The Mattermost plugin host hands the page its own colours. Nothing in this
// repository calls this — the desktop and server builds own their theme — but
// the same bundle is meant to run as a plugin, where the host's palette has to
// win over ours.
//
// It writes the *raw* tokens rather than the derived ones, so everything
// `_tokens.scss` builds on top of them follows without being enumerated here.
// Inline properties on the document element outrank the stylesheet, so the two
// layers compose without either knowing about the other.
export function setMattermostTheme(theme: any): void {
    if (!theme) {
        loadTheme()
        return
    }

    const raw: Record<string, string> = {
        '--canvas-rgb': rgb(theme.centerChannelBg),
        '--surface-rgb': rgb(theme.centerChannelBg),
        '--ink-rgb': rgb(theme.centerChannelColor),
        '--sidebar-rgb': rgb(theme.sidebarBg),
        '--sidebar-ink-rgb': rgb(theme.sidebarText || '#ffffff'),
        '--accent-rgb': rgb(theme.buttonBg),
        '--accent-ink-rgb': rgb(theme.buttonColor),
        '--stamp-rgb': rgb(theme.sidebarTextActiveBorder),
    }
    for (const [name, value] of Object.entries(raw)) {
        if (value) {
            document.documentElement.style.setProperty(name, value)
        }
    }
}

// The host's colours arrive as CSS colour strings; ours are bare triples, so
// that `rgba(var(--x), α)` works everywhere.
function rgb(value: string | undefined): string {
    if (!value) {
        return ''
    }
    const hex = value.trim().replace('#', '')
    if (hex.length !== 3 && hex.length !== 6) {
        return ''
    }
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    const n = parseInt(full, 16)
    if (isNaN(n)) {
        return ''
    }
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(', ')
}
