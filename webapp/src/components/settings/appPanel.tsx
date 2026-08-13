import {For, Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {Constants} from '../../constants'
import {useAppStore} from '../../store/hooks'
import CheckIcon from '../../widgets/icons/check'
import {
    darkThemeName,
    getActiveThemeName,
    lightThemeName,
    setTheme,
    systemThemeName,
    ThemeName,
} from '../../theme'

import './appPanel.scss'

// The app talking about itself: how it looks, what language it speaks, where
// it is written down, and where to say that something is broken. All four
// lived in the corner of the board — two icon menus, a question mark and a
// link — where an icon had to stand for a word and the corner grew a control
// per answer. They are read once and set once, which is what the rest of this
// dialog is for; the corner is gone with the last of them.
//
// The choices are laid out rather than folded into a menu: there are three
// themes and a dozen languages, and a person picking one wants to see what
// there is. A menu in a dialog would also have been a menu inside a scrolling
// panel, which is where a dropdown gets clipped.

const AppPanel = () => {
    const intl = useIntl()
    const {actions} = useAppStore()

    // The theme module writes an attribute on the document and is not reactive,
    // so which one is current is kept here, seeded with what startup loaded.
    const [themeName, setThemeName] = createSignal(getActiveThemeName())

    // Spelled out rather than built as `Sidebar.${theme.id}`: a computed id is
    // invisible to `npm run i18n-extract`, so these three never reached en.json
    // and read as dead entries in every other catalogue.
    const themes = (): Array<{id: ThemeName, displayName: string}> => [
        {id: lightThemeName, displayName: intl.formatMessage({id: 'Sidebar.light-theme', defaultMessage: 'Light theme'})},
        {id: darkThemeName, displayName: intl.formatMessage({id: 'Sidebar.dark-theme', defaultMessage: 'Dark theme'})},
        {id: systemThemeName, displayName: intl.formatMessage({id: 'Sidebar.system-theme', defaultMessage: 'System theme'})},
    ]

    const choiceClass = (current: boolean) => `AppPanel__choice${current ? ' AppPanel__choice--current' : ''}`

    return (
        <div class='AppPanel'>
            <div class='AppPanel__subtitle'>
                {intl.formatMessage({
                    id: 'Settings.app-subtitle',
                    defaultMessage: 'The app\'s theme and language, the guide, and where to report a problem.',
                })}
            </div>

            <div class='AppPanel__content'>
                <section class='AppPanel__group'>
                    <h4 class='AppPanel__groupTitle'>
                        {intl.formatMessage({id: 'Settings.theme', defaultMessage: 'Theme'})}
                    </h4>
                    <div class='AppPanel__choices'>
                        <For each={themes()}>
                            {(theme) => (
                                <button
                                    type='button'
                                    class={choiceClass(themeName() === theme.id)}
                                    aria-pressed={themeName() === theme.id}
                                    onClick={() => {
                                        setTheme(theme.id)
                                        setThemeName(theme.id)
                                    }}
                                >
                                    <span class='AppPanel__choiceName'>{theme.displayName}</span>
                                    <Show when={themeName() === theme.id}>
                                        <span class='AppPanel__choiceTick'><CheckIcon/></span>
                                    </Show>
                                </button>
                            )}
                        </For>
                    </div>
                </section>

                <section class='AppPanel__group'>
                    <h4 class='AppPanel__groupTitle'>
                        {intl.formatMessage({id: 'Settings.language', defaultMessage: 'Language'})}
                    </h4>
                    <div class='AppPanel__choices'>
                        <For each={Constants.languages}>
                            {(language) => (
                                <button
                                    type='button'
                                    class={choiceClass(intl.locale.toLowerCase() === language.code)}
                                    aria-pressed={intl.locale.toLowerCase() === language.code}
                                    onClick={() => actions.language.storeLanguage(language.code)}
                                >
                                    <span class='AppPanel__choiceName'>{language.displayName}</span>
                                    <Show when={intl.locale.toLowerCase() === language.code}>
                                        <span class='AppPanel__choiceTick'><CheckIcon/></span>
                                    </Show>
                                </button>
                            )}
                        </For>
                    </div>
                </section>

                <section class='AppPanel__group'>
                    <h4 class='AppPanel__groupTitle'>
                        {intl.formatMessage({id: 'Settings.help', defaultMessage: 'Help'})}
                    </h4>
                    <div class='AppPanel__action'>
                        <div class='AppPanel__actionText'>
                            <span class='AppPanel__actionName'>
                                {intl.formatMessage({id: 'Settings.help-page', defaultMessage: 'The guide'})}
                            </span>
                            <span class='AppPanel__actionHint'>
                                {intl.formatMessage({
                                    id: 'Settings.help-hint',
                                    defaultMessage: 'How the board, its columns and its routes work, screen by screen.',
                                })}
                            </span>
                        </div>
                        <a
                            class='AppPanel__actionLink'
                            href={Constants.guideUrl}
                            target='_blank'
                            rel='noreferrer'
                        >
                            {intl.formatMessage({id: 'Settings.help-open', defaultMessage: 'Open'})}
                        </a>
                    </div>

                    {/* The one thing in the old corner that was about the
                        moment rather than about the app, and the last reason
                        that corner existed. It goes next to the guide because
                        the two are one question apart: what is written down,
                        and what to do when it does not match. */}
                    <div class='AppPanel__action'>
                        <div class='AppPanel__actionText'>
                            <span class='AppPanel__actionName'>
                                {intl.formatMessage({id: 'Settings.feedback', defaultMessage: 'Give feedback'})}
                            </span>
                            <span class='AppPanel__actionHint'>
                                {intl.formatMessage({
                                    id: 'Settings.feedback-hint',
                                    defaultMessage: 'Bugs and requests go by email, to {email}.',
                                }, {email: Constants.feedbackEmail})}
                            </span>
                        </div>
                        <a
                            class='AppPanel__actionLink'
                            href={Constants.feedbackUrl}
                        >
                            {intl.formatMessage({id: 'Settings.feedback-open', defaultMessage: 'Write'})}
                        </a>
                    </div>
                </section>
            </div>
        </div>
    )
}

export default AppPanel
