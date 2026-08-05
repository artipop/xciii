// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Separate from vite.config.ts rather than a `test` block inside it, because a
// test run wants a different pipeline than a build: no formatjs pre-compilation
// (@formatjs/intl compiles the same messages at runtime, which is what every
// snapshot in the suite was recorded against) and none of the build's output
// wiring. What the two must share is vite-plugin-solid, and one plugin instance
// is exactly what stops solid-js being loaded twice.

import path from 'path'
import {fileURLToPath} from 'url'

import {defineConfig} from 'vitest/config'
import solid from 'vite-plugin-solid'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
    root,

    // The plugin also settles what jest needed customExportConditions for: in
    // test mode it resolves solid-js to its browser development build, without
    // which a component renders once and never reacts again.
    plugins: [solid()],

    resolve: {
        alias: [

            // Vite would resolve an imported asset to a URL that differs between
            // a dev server and a build; the suite wants one stable string, and
            // the snapshots already contain it.
            // The pattern has to match the whole specifier: a regex alias
            // rewrites what it matched, so anchoring it to the extension alone
            // would leave the directories in front of a replaced suffix.
            {
                find: /^.+\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$/,
                replacement: path.join(root, '__mocks__/fileMock.js'),
            },
        ],
    },

    test: {

        // The suite was written against jest's injected globals, so `describe`,
        // `expect` and `vi` are expected to exist without an import.
        globals: true,

        // jsdom, not happy-dom: the fakes in src/test are written against its
        // quirks, and the suite drives real DOM APIs rather than a fast subset.
        environment: 'jsdom',

        environmentOptions: {

            // jest served the page from http://localhost/, vitest defaults to
            // port 3000. Anything the app builds out of window.location -- an
            // API URL, a share link -- is asserted against the former.
            jsdom: {url: 'http://localhost/'},
        },

        // jsdomPolyfills has to run first: it installs what modules read while
        // they are being evaluated (fetch, ResizeObserver, PointerEvent).
        // vite-plugin-solid appends @testing-library/jest-dom to this list.
        setupFiles: [
            path.join(root, 'src/test/jsdomPolyfills.ts'),
            path.join(root, 'src/test/dndKitSnapshotSerializer.ts'),
        ],

        // Half the cores, as under jest: the suite is wide enough that full
        // parallelism buys little beyond making the machine unusable.
        maxWorkers: '50%',

        coverage: {

            // v8's own counters rather than an instrumenting babel pass, which
            // is what let babel out of the toolchain altogether.
            provider: 'v8',
            enabled: true,
            include: ['src/**/*.{ts,tsx,js,jsx}'],
            exclude: ['src/test/**'],
        },
    },
})
