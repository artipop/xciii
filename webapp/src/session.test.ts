import {forgetSession, rememberSession, sessionToken} from './session'

const cookie = (): string => document.cookie

describe('session', () => {
    beforeEach(() => {
        localStorage.clear()
        forgetSession()
    })

    // The token has to travel twice, and the second way is what the front door
    // reads: the Wails runtime makes its own fetches and a browser lets nobody
    // set a header on a WebSocket handshake (team.go). Losing this is losing
    // every bound method and both sockets on a team install.
    it('keeps a session where both the page and the front door can read it', () => {
        rememberSession('a-token')

        expect(sessionToken()).toBe('a-token')
        expect(cookie()).toContain('xciiiSession=a-token')
    })

    it('takes both away when the session ends', () => {
        rememberSession('a-token')
        forgetSession()

        expect(sessionToken()).toBe('')
        expect(cookie()).not.toContain('a-token')
    })
})
