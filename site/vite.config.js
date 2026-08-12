import {defineConfig} from 'vite'

// Two pages, so the entries are listed by hand: on its own Vite finds only the
// index.html at the root. `mpa` keeps the dev server from answering /xciii/
// with the home page.
export default defineConfig({
    appType: 'mpa',

    // On the deploy /docs/ is a folder inside dist/; in dev it is a second
    // server, so the link to the guide in the header would be a 404 exactly
    // where it is being written. The proxy makes the two look like one site
    // here too — `npm run dev` in docs/guide (pinned to 5174) answers it.
    server: {
        proxy: {
            // `ws` because the guide's own hot reload talks over a socket on
            // this path too, and a proxy that forwards only HTTP leaves it
            // reconnecting for ever.
            '/docs': {target: 'http://localhost:5174', ws: true},
        },
    },

    build: {
        rollupOptions: {
            input: {
                index: new URL('index.html', import.meta.url).pathname,
                xciii: new URL('xciii/index.html', import.meta.url).pathname,
            },
        },
    },
})
