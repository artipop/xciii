
enum Permission {
    ManageBoardType = 'manage_board_type',
    DeleteBoard = 'delete_board',
    ShareBoard = 'share_board',
    ManageBoardRoles = 'manage_board_roles',
    ChannelCreatePost = 'create_post',
    ManageBoardCards = 'manage_board_cards',
    ManageBoardProperties = 'manage_board_properties',
    CommentBoardCards = 'comment_board_cards',
    ViewBoard = 'view_board',
    DeleteOthersComments = 'delete_others_comments'
}

class Constants {
    static readonly menuColors: {[key: string]: string} = {
        propColorDefault: 'Default',
        propColorGray: 'Gray',
        propColorBrown: 'Brown',
        propColorOrange: 'Orange',
        propColorYellow: 'Yellow',
        propColorGreen: 'Green',
        propColorBlue: 'Blue',
        propColorPurple: 'Purple',
        propColorPink: 'Pink',
        propColorRed: 'Red',
    }

    static readonly minColumnWidth = 100
    static readonly defaultTitleColumnWidth = 280
    static readonly tableHeaderId = '__header'
    static readonly tableCalculationId = '__calculation'
    static readonly titleColumnId = '__title'
    static readonly badgesColumnId = '__badges'

    static readonly versionString = '1.0.0'
    static readonly versionDisplayString = 'June 2024'

    // The product's own pages, and the only addresses the UI hands out: what
    // the app is, how it works, and where a person writes when it does not.
    // The repository stood for all three while there was no site; it is not an
    // answer to any of them — somebody who opens «Руководство» wants the manual,
    // not a source tree, and a bug report is a letter rather than an account on
    // a hosting service.
    static readonly homeUrl = 'https://deffun.com/xciii/'
    static readonly guideUrl = 'https://deffun.com/docs/'
    static readonly feedbackEmail = 'hello@deffun.com'
    static readonly feedbackUrl = `mailto:${Constants.feedbackEmail}`

    // The three import cards point at our own guide, not at the service being
    // imported from and not — as they did until the fork shrink — at
    // docs.mattermost.com's "migrate to Boards" page, which is a different
    // product's documentation with anchors this app's menu invented.
    static readonly archiveHelpPage = `${Constants.guideUrl}transfer`
    static readonly imports = [
        {
            id: 'trello',
            displayName: 'Trello',
            href: Constants.archiveHelpPage,
        },
        {
            id: 'notion',
            displayName: 'Notion',
            href: Constants.archiveHelpPage,
        },
        {
            id: 'todoist',
            displayName: 'Todoist',
            href: Constants.archiveHelpPage,
        },
    ]

    static readonly languages = [
        {
            code: 'en',
            name: 'english',
            displayName: 'English',
        },
        {
            code: 'es',
            name: 'spanish',
            displayName: 'Español',
        },
        {
            code: 'de',
            name: 'german',
            displayName: 'Deutsch',
        },
        {
            code: 'ja',
            name: 'japanese',
            displayName: '日本語',
        },
        {
            code: 'fr',
            name: 'french',
            displayName: 'Français',
        },
        {
            code: 'nl',
            name: 'dutch',
            displayName: 'Nederlands',
        },
        {
            code: 'ru',
            name: 'russian',
            displayName: 'Русский',
        },
        {
            code: 'zh-tw',
            name: 'traditional-chinese',
            displayName: '中文 (繁體)',
        },
        {
            code: 'zh-cn',
            name: 'simplified-chinese',
            displayName: '中文 (简体)',
        },
        {
            code: 'tr',
            name: 'turkish',
            displayName: 'Türkçe',
        },
        {
            code: 'oc',
            name: 'occitan',
            displayName: 'Occitan',
        },
        {
            code: 'pt-br',
            name: 'portuguese',
            displayName: 'Português (Brasil)',
        },
        {
            code: 'ca',
            name: 'catalan',
            displayName: 'Català',
        },
        {
            code: 'el',
            name: 'greek',
            displayName: 'Ελληνικά',
        },
        {
            code: 'id',
            name: 'indonesian',
            displayName: 'bahasa Indonesia',
        },
        {
            code: 'it',
            name: 'italian',
            displayName: 'Italiano',
        },
        {
            code: 'sv',
            name: 'swedish',
            displayName: 'Svenska',
        },
    ]

    static readonly keyCodes: {[key: string]: [string, number]} = {
        COMPOSING: ['Composing', 229],
        ESC: ['Esc', 27],
        UP: ['Up', 38],
        DOWN: ['Down', 40],
        ENTER: ['Enter', 13],
        A: ['a', 65],
        B: ['b', 66],
        C: ['c', 67],
        D: ['d', 68],
        E: ['e', 69],
        F: ['f', 70],
        G: ['g', 71],
        H: ['h', 72],
        I: ['i', 73],
        J: ['j', 74],
        K: ['k', 75],
        L: ['l', 76],
        M: ['m', 77],
        N: ['n', 78],
        O: ['o', 79],
        P: ['p', 80],
        Q: ['q', 81],
        R: ['r', 82],
        S: ['s', 83],
        T: ['t', 84],
        U: ['u', 85],
        V: ['v', 86],
        W: ['w', 87],
        X: ['x', 88],
        Y: ['y', 89],
        Z: ['z', 90],
    }

    static readonly globalTeamId = '0'
    static readonly noChannelID = '0'

    static readonly SystemUserID = 'system'
}

export {Constants, Permission}
