// The types a plugin author writes against. They mirror sources/protocol, which
// is the one declaration of the wire; anything that disagrees with it is a bug
// here and not there.

export declare const PROTOCOL_VERSION: number

export declare const ERROR_RETRYABLE: 'retryable'
export declare const ERROR_NEEDS_REAUTH: 'needs_reauth'
export declare const ERROR_BAD_CONFIG: 'bad_config'

/** One thing a plugin found. */
export type Item = {
    /**
     * Which thing this is, in the source's own namespace. Without it the app
     * hashes the content, and an item whose text changes becomes a second card.
     */
    id: string

    /** Which state of it. The app re-reads an item only when this changes. */
    version?: string

    title: string
    body?: string
    url?: string

    /** RFC 3339. */
    at?: string

    props?: Record<string, string>
    labels?: string[]
}

export type Capabilities = {
    /** The plugin answers poll. */
    poll?: boolean

    /** The plugin talks when it has something, without being asked. */
    push?: boolean

    /** poll results carry a cursor worth handing back. */
    cursor?: boolean

    /**
     * A stream where most items are not wanted. It decides what happens to an
     * item no rule matched: dropped here, filed in the inbox everywhere else.
     */
    noisy?: boolean

    /** What the plugin needs to be given: 'token' or 'oauth2'. */
    auth?: string
}

export type Credentials = {
    /** The access token of this source, and nothing else. */
    accessToken?: string
    expiresAt?: string
}

export type PollRequest = {
    config: Record<string, string>
    credentials: Credentials

    /** Whatever this plugin returned last time; opaque to the app. */
    cursor: string
}

export type PollResult = {
    items?: Item[]
    cursor?: string

    /** Ask the app to wait at least this long before asking again. */
    retryAfterSeconds?: number
}

/** What a plugin talks to the app through outside of an answer. */
export type Session = {
    config: Record<string, string>
    credentials: Credentials
    items(items: Item[], cursor?: string): void
    log(level: 'info' | 'warn' | 'error', message: string): void
    needsReauth(reason: string): void
}

export type Source = {
    capabilities: Capabilities

    /** Called on the app's schedule. Required when capabilities.poll. */
    poll?(request: PollRequest): Promise<PollResult> | PollResult

    /**
     * Called once, after the handshake, for a plugin that watches something.
     * The watching itself belongs on a timer or a listener; this must return.
     */
    start?(session: Session): Promise<void> | void

    /** Called when the app is closing, before the process ends. */
    shutdown?(): Promise<void> | void
}

export declare class SourceError extends Error {
    kind?: string
    field?: string
    constructor(kind: string, message: string, field?: string)
}

export declare function retryable(message: string): SourceError
export declare function needsReauth(message: string): SourceError
export declare function badConfig(field: string, message: string): SourceError

/** Runs the plugin until the app closes its input or asks it to stop. */
export declare function serve(source: Source): void
