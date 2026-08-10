// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import en from '../i18n/en.json'
import ru from '../i18n/ru.json'

import {getMessages} from './i18n'

// The arguments a message expects, read off the braces. A hand-rolled scanner
// rather than the ICU parser, which is only in the tree as somebody else's
// dependency: nesting is what a regex cannot follow, and depth is all this
// needs to follow it.
function messageArguments(message: string): string[] {
    const found = new Set<string>()
    for (let i = 0; i < message.length; i++) {
        if (message[i] !== '{') {
            continue
        }
        const rest = message.slice(i + 1)
        const name = ((/^\s*([A-Za-z_][\w]*)\s*[,}]/).exec(rest) || [])[1]
        if (name) {
            found.add(name)
        }
    }
    return [...found].sort()
}

describe('the message catalogues', () => {
    // en.json is generated from the defaults written in the components, so an
    // id missing from it is an id nobody typed and a stale line in every
    // translation. Russian is the language the app is written for, so a gap
    // there is English on a Russian screen.
    test('English and Russian answer for exactly the same messages', () => {
        const missing = Object.keys(en).filter((id) => !(id in ru))
        const stale = Object.keys(ru).filter((id) => !(id in en))

        expect({missing, stale}).toEqual({missing: [], stale: []})
    })

    // A placeholder that survives in one language and not the other formats to
    // a sentence with a hole in it — «изменить свойство ""» — and nothing
    // fails loudly enough to notice.
    test('a message asks for the same values in both languages', () => {
        const mismatched = Object.keys(en).
            map((id) => ({id, en: messageArguments(en[id]), ru: messageArguments(ru[id] || '')})).
            filter((row) => row.en.join() !== row.ru.join())

        expect(mismatched).toEqual([])
    })

    // Every catalogue the language menu offers has to resolve to a catalogue,
    // or picking that language silently leaves the app in English.
    test('every offered language resolves to messages of its own', () => {
        const codes = ['ca', 'de', 'el', 'es', 'fr', 'id', 'it', 'ja', 'nl', 'oc', 'pt-br', 'ru', 'sv', 'tr', 'zh-cn', 'zh-tw']

        for (const code of codes) {
            expect(getMessages(code)).not.toBe(en)
        }
        expect(getMessages('en')).toBe(en)
    })
})
