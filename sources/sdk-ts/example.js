// A source plugin in JavaScript, whole. Run it the way its author would:
//
//     go run ./cmd/sourcecheck -- node sources/sdk-ts/example.js
//
// It is the same plugin as sources/sdk/example in Go, on purpose: the two say
// the same things on the wire, which is the whole claim the protocol makes.

import {serve} from './index.js'

serve({
    capabilities: {poll: true, cursor: true},

    poll({cursor}) {
        // The cursor is this plugin's own bookmark: the app stores it and hands
        // it back, and never looks inside. Here it means "already told them".
        if (cursor) {
            return {cursor}
        }
        return {
            items: [{
                id: 'example-1',
                version: '1',
                title: 'Пример записи от плагина',
                body: 'Всё, что делает плагин, — возвращает такие записи.',
                at: new Date().toISOString(),
                props: {app: 'example'},
            }],
            cursor: 'done',
        }
    },
})
