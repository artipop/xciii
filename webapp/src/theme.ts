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
