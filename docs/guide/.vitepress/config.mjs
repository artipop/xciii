import {defineConfig} from 'vitepress'

// The user guide as a site. VitePress was picked over the alternatives for two
// reasons: it is Vite, which this repository already builds two other things
// with, and it highlights code with Shiki at build time — so a JSON body or a
// curl line in the guide is coloured in the output and costs the reader no
// JavaScript at all.
//
// The root of this site is the guide's own directory: the markdown stays where
// the repository's convention puts it (`docs/guide/`), and nothing from
// `docs/` — those pages are for whoever works on the code — can end up
// published by accident.
//
// Two locales: Russian at the root, English under /en/. Russian is the
// original — the product is written in it — and the English pages are a
// translation kept beside it, page for page, so the language switcher never
// lands a reader on a page that does not exist.

const ru = {
    label: 'Русский',
    lang: 'ru-RU',
    titleTemplate: ':title — руководство XCIII',
    description: 'Руководство пользователя XCIII: доска, агенты, маршруты, Входящие и настройки.',

    themeConfig: {
        siteTitle: 'XCIII · Руководство',

        nav: [
            {text: 'Доска', link: '/board'},
            {text: 'Агент', link: '/agent'},
            {text: 'Автоматизация', link: '/automation/'},
            {text: 'Входящие', link: '/inbox/'},
            {text: 'Настройки', link: '/settings/'},
        ],

        sidebar: [
            {
                text: 'Доска',
                items: [
                    {text: 'Название, описание, меню', link: '/board'},
                    {text: 'Агент на карточке', link: '/agent'},
                    {text: 'Папки и ветки', link: '/folders'},
                ],
            },
            {
                text: 'Автоматизация',
                items: [
                    {text: 'Колонки и маршруты', link: '/automation/'},
                    {text: 'Правила на стрелках', link: '/automation/rules'},
                    {text: 'Собрать маршрут', link: '/automation/flow'},
                    {text: 'Системный промпт доски', link: '/automation/prompt'},
                ],
            },
            {
                text: 'Входящие',
                items: [
                    {text: 'Обзор', link: '/inbox/'},
                    {text: 'Источники', link: '/inbox/sources'},
                ],
            },
            {
                text: 'Настройки',
                items: [
                    {text: 'Обзор', link: '/settings/'},
                    {text: 'Агенты, npx и Node.js', link: '/settings/agents'},
                    {text: 'Обновления', link: '/settings/updates'},
                ],
            },
            {
                text: 'Перенос',
                items: [
                    {text: 'Перенос доски', link: '/transfer'},
                ],
            },
        ],

        // Everything a reader sees is Russian, including the theme's own
        // furniture — the defaults are English.
        outline: {level: [2, 3], label: 'На этой странице'},
        docFooter: {prev: 'Назад', next: 'Дальше'},
        returnToTopLabel: 'Наверх',
        sidebarMenuLabel: 'Разделы',
        langMenuLabel: 'Сменить язык',
        darkModeSwitchLabel: 'Оформление',
        lightModeSwitchTitle: 'Светлая тема',
        darkModeSwitchTitle: 'Тёмная тема',
        lastUpdatedText: 'Обновлено',

        footer: {
            message: 'Руководство пользователя XCIII',
            copyright: '© 2026 deffun',
        },

        notFound: {
            title: 'Такой страницы нет',
            quote: 'Возможно, раздел переехал — он должен быть в списке слева.',
            linkText: 'К началу руководства',
        },
    },
}

const en = {
    label: 'English',
    lang: 'en-US',
    link: '/en/',
    titleTemplate: ':title — the XCIII guide',
    description: 'The XCIII user guide: the board, agents, routes, the inbox and the settings.',

    themeConfig: {
        siteTitle: 'XCIII · Guide',

        nav: [
            {text: 'Board', link: '/en/board'},
            {text: 'Agent', link: '/en/agent'},
            {text: 'Automation', link: '/en/automation/'},
            {text: 'Inbox', link: '/en/inbox/'},
            {text: 'Settings', link: '/en/settings/'},
        ],

        sidebar: [
            {
                text: 'The board',
                items: [
                    {text: 'Title, description, menu', link: '/en/board'},
                    {text: 'The agent on a card', link: '/en/agent'},
                    {text: 'Folders and branches', link: '/en/folders'},
                ],
            },
            {
                text: 'Automation',
                items: [
                    {text: 'Columns and routes', link: '/en/automation/'},
                    {text: 'Conditions on arrows', link: '/en/automation/rules'},
                    {text: 'Build a route', link: '/en/automation/flow'},
                    {text: 'The board’s system prompt', link: '/en/automation/prompt'},
                ],
            },
            {
                text: 'Inbox',
                items: [
                    {text: 'Overview', link: '/en/inbox/'},
                    {text: 'Sources', link: '/en/inbox/sources'},
                ],
            },
            {
                text: 'Settings',
                items: [
                    {text: 'Overview', link: '/en/settings/'},
                    {text: 'Agents, npx and Node.js', link: '/en/settings/agents'},
                    {text: 'Updates', link: '/en/settings/updates'},
                ],
            },
            {
                text: 'Moving',
                items: [
                    {text: 'Moving a board', link: '/en/transfer'},
                ],
            },
        ],

        outline: {level: [2, 3], label: 'On this page'},

        footer: {
            message: 'The XCIII user guide',
            copyright: '© 2026 deffun',
        },

        notFound: {
            title: 'No such page',
            quote: 'The section may have moved — it should be in the list on the left.',
            linkText: 'To the start of the guide',
        },
    },
}

export default defineConfig({
    title: 'XCIII',

    // The product is a screen, so the screen theme is the one a reader gets
    // first — the same decision the landing page makes.
    appearance: 'dark',
    lastUpdated: true,

    // Links keep their `.html`. Clean URLs are prettier and need the host to
    // strip the extension itself — GitHub Pages and a plain S3 bucket do not,
    // and a guide that 404s depending on where it was uploaded is worse than
    // one with an extension in the address.
    cleanUrls: false,

    // Published under /docs/ of the site, and built straight into the site's
    // own dist so that a deploy is one directory. The landing's build empties
    // dist/ first, so the order in site/package.json's `build:all` matters.
    base: '/docs/',
    outDir: '../../site/dist/docs',

    head: [
        ['link', {rel: 'icon', href: '/docs/favicon.svg'}],
    ],

    markdown: {
        theme: {light: 'github-light', dark: 'github-dark'},
    },

    locales: {root: ru, en},

    themeConfig: {

        // No social links, and in particular no repository: the guide is for
        // somebody using the product, and a source tree is not an answer to
        // anything asked here. Where to write when something is broken is on
        // the settings page, where the app itself offers it.

        search: {
            provider: 'local',
            options: {
                // The default translations are English, so only the root
                // locale needs spelling out.
                translations: {
                    button: {
                        buttonText: 'Поиск',
                        buttonAriaLabel: 'Поиск по руководству',
                    },
                    modal: {
                        displayDetails: 'Показать подробности',
                        resetButtonTitle: 'Очистить',
                        backButtonTitle: 'Закрыть',
                        noResultsText: 'Ничего не нашлось',
                        footer: {
                            selectText: 'открыть',
                            navigateText: 'листать',
                            closeText: 'закрыть',
                        },
                    },
                },
                locales: {
                    en: {
                        translations: {
                            button: {
                                buttonText: 'Search',
                                buttonAriaLabel: 'Search the guide',
                            },
                            modal: {
                                displayDetails: 'Show details',
                                resetButtonTitle: 'Clear',
                                backButtonTitle: 'Close',
                                noResultsText: 'Nothing found',
                                footer: {
                                    selectText: 'open',
                                    navigateText: 'browse',
                                    closeText: 'close',
                                },
                            },
                        },
                    },
                },
            },
        },
    },
})
