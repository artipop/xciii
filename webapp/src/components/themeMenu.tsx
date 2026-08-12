// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import Menu from '../widgets/menu'
import MenuWrapper from '../widgets/menuWrapper'
import CheckIcon from '../widgets/icons/check'
import ThemeIcon from '../widgets/icons/theme'
import {
    darkThemeName,
    getActiveThemeName,
    lightThemeName,
    setTheme,
    systemThemeName,
    ThemeName,
} from '../theme'

// The theme is not a setting of this install the way an agent or a deploy
// target is — it is how the person in front of the screen wants to look at it,
// changed on a whim and changed back. That is why it sits in the corner of the
// board with the language, one click away, instead of behind the dialog where
// the settings that are decided once live.

const ThemeMenu = (): JSX.Element => {
    const intl = useIntl()

    // The theme module is not reactive — it writes an attribute on the document
    // — so the tick beside the current entry is kept here, seeded with whatever
    // was loaded at startup.
    const [themeName, setThemeName] = createSignal(getActiveThemeName())

    // Spelled out rather than built as `Sidebar.${theme.id}`: a computed id is
    // invisible to `npm run i18n-extract`, so these three never reached
    // en.json and read as dead entries in every other catalogue.
    const themes = (): Array<{id: ThemeName, displayName: string}> => [
        {id: lightThemeName, displayName: intl.formatMessage({id: 'Sidebar.light-theme', defaultMessage: 'Light theme'})},
        {id: darkThemeName, displayName: intl.formatMessage({id: 'Sidebar.dark-theme', defaultMessage: 'Dark theme'})},
        {id: systemThemeName, displayName: intl.formatMessage({id: 'Sidebar.system-theme', defaultMessage: 'System theme'})},
    ]

    const label = intl.formatMessage({id: 'Sidebar.set-theme', defaultMessage: 'Set theme'})

    return (
        <div class='ThemeMenu'>
            <MenuWrapper
                menu={
                    <Menu position='left'>
                        <For each={themes()}>
                            {(theme) => (
                                <Menu.Text
                                    id={theme.id}
                                    name={theme.displayName}
                                    onClick={async () => {
                                        setTheme(theme.id)
                                        setThemeName(theme.id)
                                    }}
                                    rightIcon={themeName() === theme.id ? <CheckIcon/> : null}
                                />
                            )}
                        </For>
                    </Menu>
                }
            >
                <button
                    type='button'
                    class='TopBar__button'
                    aria-label={label}
                    title={label}
                >
                    <ThemeIcon/>
                </button>
            </MenuWrapper>
        </div>
    )
}

export default ThemeMenu
