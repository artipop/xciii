import {WSClient} from './wsclient'

// What happens when the board's socket is refused rather than dropped.
//
// The server accepts the upgrade and then closes the connection if the token it
// is handed means nothing (server/ws/server.go) — there is no error message to
// read, only the close. So the client cannot be told in words; what it can see
// is that the connection died the instant it opened, which a working one does
// not do.
//
// This matters because every reconnect re-runs the whole board load
// (boardPage.tsx), so a session that is never going to be accepted used to mean
// seven refused API calls every three seconds, for as long as the page was open.

type FakeSocket = {
    onopen?: () => void
    onclose?: (e: {code: number, reason: string}) => void
    onerror?: (e: unknown) => void
    onmessage?: (e: {data: string}) => void
    close: () => void
    send: () => void
    readyState: number
}

const sockets: FakeSocket[] = []

class StubWebSocket {
    static readonly OPEN = 1
    onopen?: () => void
    onclose?: (e: {code: number, reason: string}) => void
    onerror?: (e: unknown) => void
    onmessage?: (e: {data: string}) => void
    readyState = 1
    close = vi.fn()
    send = vi.fn()

    constructor() {
        sockets.push(this as unknown as FakeSocket)
    }
}

describe('wsclient reconnection', () => {
    beforeEach(() => {
        sockets.length = 0
        vi.useFakeTimers()
        ;(global as any).WebSocket = StubWebSocket
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    // The connection that is refused: opened, closed at once, again and again.
    // It has to run out, or the page never stops asking.
    it('gives up on a socket that is refused as soon as it opens', () => {
        const client = new WSClient('http://localhost:8080')
        client.open()

        // Ten attempts is the budget; the eleventh must not be scheduled.
        for (let i = 0; i < 20; i++) {
            const socket = sockets[sockets.length - 1]
            socket.onopen?.()
            socket.onclose?.({code: 1006, reason: 'refused'})
            vi.advanceTimersByTime(5000)
        }

        expect(sockets.length).toBeLessThanOrEqual(11)
    })

    // A connection that worked and was then dropped — the machine slept, the
    // server restarted — gets its full budget back, which is what the reset was
    // there for in the first place.
    it('keeps reconnecting after a connection that actually worked', () => {
        const client = new WSClient('http://localhost:8080')
        client.open()

        for (let i = 0; i < 20; i++) {
            const socket = sockets[sockets.length - 1]
            socket.onopen?.()
            vi.advanceTimersByTime(60000)
            socket.onclose?.({code: 1006, reason: 'network'})
            vi.advanceTimersByTime(5000)
        }

        expect(sockets.length).toBeGreaterThan(11)
    })
})
