// The TypeScript/JavaScript half of sources/protocol: what a plugin written in
// Node is built on, and the other end of the same wire the Go SDK speaks.
//
// It has no dependencies and no build step. That is deliberate: a plugin author
// installing this should get one file, and `npx` should be able to run their
// package without a toolchain of its own. The types are in index.d.ts, for the
// authors who want them.
//
// stdout belongs to the protocol. A plugin that console.log()s costs itself
// that line — the app says so in the source's log and carries on — so anything
// a plugin wants to say goes through session.log().

import {createInterface} from 'node:readline'

export const PROTOCOL_VERSION = 1

export const ERROR_RETRYABLE = 'retryable'
export const ERROR_NEEDS_REAUTH = 'needs_reauth'
export const ERROR_BAD_CONFIG = 'bad_config'

// A refusal the app can act on: come back later, ask a person, or wait for the
// config to be corrected. Anything thrown that is not one of these is treated
// as a defect of the plugin.
export class SourceError extends Error {
    constructor(kind, message, field) {
        super(message)
        this.kind = kind
        this.field = field
    }
}

export const retryable = (message) => new SourceError(ERROR_RETRYABLE, message)
export const needsReauth = (message) => new SourceError(ERROR_NEEDS_REAUTH, message)
export const badConfig = (field, message) => new SourceError(ERROR_BAD_CONFIG, message, field)

const write = (message) => {
    process.stdout.write(JSON.stringify(message) + '\n')
}

const reply = (id, result) => write({jsonrpc: '2.0', id, result})

const fail = (id, error) => {
    const data = {}
    if (error instanceof SourceError) {
        if (error.kind) {
            data.kind = error.kind
        }
        if (error.field) {
            data.field = error.field
        }
    }
    write({jsonrpc: '2.0', id, error: {code: -32000, message: String(error?.message || error), data}})
}

// serve runs the plugin until the app closes its input or asks it to stop. It
// is the whole of a plugin's entry point.
export function serve(source) {
    const capabilities = source.capabilities || {}
    const session = {
        config: {},
        credentials: {},
        items: (items, cursor) => write({jsonrpc: '2.0', method: 'items', params: {items, cursor}}),
        log: (level, message) => write({jsonrpc: '2.0', method: 'log', params: {level, message}}),
        needsReauth: (reason) => write({jsonrpc: '2.0', method: 'needsReauth', params: {reason}}),
    }

    const lines = createInterface({input: process.stdin})

    // One message at a time, in order. The app may send the next request before
    // this one is answered, and a plugin that interleaved them would answer out
    // of order — which the ids allow, but nothing gains from.
    let queue = Promise.resolve()
    lines.on('line', (line) => {
        let request
        try {
            request = JSON.parse(line)
        } catch {
            return
        }
        queue = queue.then(() => handle(source, session, capabilities, request, lines))
    })

    lines.on('close', async () => {
        // The app was killed rather than saying goodbye; a plugin's own cleanup
        // still has to run.
        await queue
        if (source.shutdown) {
            await source.shutdown()
        }
        process.exit(0)
    })
}

async function handle(source, session, capabilities, request, lines) {
    const {id, method, params} = request
    switch (method) {
    case 'initialize':
        session.config = params?.source?.config || {}
        session.credentials = params?.credentials || {}
        reply(id, {protocolVersion: PROTOCOL_VERSION, capabilities})
        if (source.start) {
            try {
                await source.start(session)
            } catch (e) {
                session.log('error', String(e?.message || e))
            }
        }
        return
    case 'poll':
        if (!source.poll) {
            fail(id, new Error('плагин не умеет отвечать на poll'))
            return
        }
        try {
            const result = await source.poll({
                config: session.config,
                credentials: session.credentials,
                cursor: params?.cursor || '',
            })
            reply(id, {
                items: result?.items || [],
                cursor: result?.cursor,
                retryAfterSeconds: result?.retryAfterSeconds,
            })
        } catch (e) {
            fail(id, e)
        }
        return
    case 'credentials/update':
        session.credentials = params || {}
        reply(id, {})
        return
    case 'shutdown':
        if (source.shutdown) {
            await source.shutdown()
        }
        reply(id, {})
        lines.close()
        process.exit(0)
    }
}
