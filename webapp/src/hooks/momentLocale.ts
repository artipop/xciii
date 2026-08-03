// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createEffect, createSignal, onCleanup} from 'solid-js'

// moment registers a locale's definitions as a side effect of importing it. The
// webpack build could resolve require(`moment/locale/${locale}`) at run time,
// but an ESM bundle has no require, so the locales are pulled in through a
// static dynamic import instead. Vite splits it into its own chunk, which an
// English UI never fetches.
let loaded = false
let pending: Promise<unknown> | null = null

function loadLocales(): Promise<unknown> {
    if (!pending) {
        pending = import('moment/min/locales').then((mod) => {
            loaded = true
            return mod
        })
    }
    return pending
}

// useMomentLocale makes moment speak the given locale. The returned revision
// signal ticks once the definitions arrive; read it wherever a formatted date
// is produced so the output leaves the English fallback.
export default function useMomentLocale(locale: () => string): () => number {
    const [revision, setRevision] = createSignal(0)

    createEffect(() => {
        const current = locale()
        if (!current || current === 'en' || loaded) {
            return
        }
        let cancelled = false
        loadLocales().then(() => {
            if (!cancelled) {
                setRevision((r) => r + 1)
            }
        })
        onCleanup(() => {
            cancelled = true
        })
    })

    return revision
}
