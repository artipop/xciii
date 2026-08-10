// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, createSignal} from 'solid-js'

// moment registers a locale's definitions as a side effect of importing it. The
// webpack build could resolve require(`moment/locale/${locale}`) at run time,
// but an ESM bundle has no require, so the locales are pulled in through a
// static dynamic import instead. Vite splits it into its own chunk, which an
// English UI never fetches.
//
// The revision is one signal for the whole page rather than one per caller,
// because the definitions are one global: moment is a module, and the import
// that teaches it Russian teaches it to every date on the screen at once. A
// per-caller signal ticked only the component that happened to ask, so a card
// comment kept saying "2 hours ago" under a Russian UI until a date picker
// elsewhere had been opened — which is exactly the shape of bug this hook
// exists to prevent.
const [revision, setRevision] = createSignal(0)
let loaded = false
let pending: Promise<unknown> | null = null

function loadLocales(): Promise<unknown> {
    if (!pending) {
        pending = import('moment/min/locales').then((mod) => {
            loaded = true
            setRevision((r) => r + 1)
            return mod
        })
    }
    return pending
}

// useMomentLocale makes moment speak the given locale. The returned revision
// signal ticks once the definitions arrive; read it wherever a formatted date
// is produced so the output leaves the English fallback.
export default function useMomentLocale(locale: () => string): () => number {
    createEffect(() => {
        const current = locale()
        if (!current || current === 'en' || loaded) {
            return
        }
        loadLocales()
    })

    return revision
}
