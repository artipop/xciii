import {defineConfig} from 'vite'

// Two pages, so the entries are listed by hand: on its own Vite finds only the
// index.html at the root. `mpa` keeps the dev server from answering /xciii/
// with the home page.
export default defineConfig({
    appType: 'mpa',
    build: {
        rollupOptions: {
            input: {
                index: new URL('index.html', import.meta.url).pathname,
                xciii: new URL('xciii/index.html', import.meta.url).pathname,
            },
        },
    },
})
