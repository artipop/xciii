// Where the board session token is kept, and why it is kept twice.
//
// The page authenticates to the board with an `Authorization: Bearer` header it
// sets itself, so localStorage is the whole of what it needs. The front door in
// front of that board needs the same token and cannot be handed a header: the
// Wails runtime makes its own fetches for every bound method, and a browser
// lets nobody set a header on a WebSocket handshake. So the token also travels
// as a cookie, which both of those carry by themselves (team.go).
//
// It is not HttpOnly, and could not be: the page writes it. That costs nothing
// it has not already spent — a script on this origin can read localStorage too.
// SameSite=Strict is the part that matters, since it keeps another site from
// sending it.

const TOKEN_KEY = 'xciiiSessionId'

// The name the front door reads. Kept in step with sessionCookie in team.go.
const COOKIE = 'xciiiSession'

export function sessionToken(): string {
    return localStorage.getItem(TOKEN_KEY) || ''
}

// rememberSession stores a token both ways. Called wherever a session begins —
// logging in, and the bootstrap script seeding a single-user install.
export function rememberSession(token: string): void {
    localStorage.setItem(TOKEN_KEY, token)
    writeCookie(token)
}

export function forgetSession(): void {
    localStorage.removeItem(TOKEN_KEY)
    writeCookie('')
}

function writeCookie(token: string): void {
    if (typeof document === 'undefined') {
        return
    }
    const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
    if (token) {
        document.cookie = `${COOKIE}=${token}; path=/; SameSite=Strict${secure}`
        return
    }
    document.cookie = `${COOKIE}=; path=/; SameSite=Strict${secure}; Max-Age=0`
}
