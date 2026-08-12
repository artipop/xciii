// jsdom's global has no fetch, and emoji-mart calls it while its module is
// being evaluated. isomorphic-fetch is already a dependency for exactly this;
// installing it once here saves the individual imports scattered through the
// suites from having to run first.
import 'isomorphic-fetch'

// jsdom implements no layout, so it has never had scrollIntoView. Under jsdom 16
// that went unnoticed; jsdom 26 delivers the focus event that rootInput's onFocus
// handler hangs off, and the call started throwing. Scrolling is exactly the kind
// of thing a headless DOM has nothing to say about, so a no-op is the whole fix --
// unlike the sizing fakes in reactFlowEnvironment.ts, it changes nothing a test
// can observe, which is why it belongs in a global setup file.
if (!global.Element.prototype.scrollIntoView) {
    global.Element.prototype.scrollIntoView = () => {}
}

// @dnd-kit/dom reads ResizeObserver while the module is being evaluated, and
// testUtils pulls it into nearly every suite, so a stub has to exist before any
// import runs. reactFlowEnvironment.ts installs one too, but that is opt-in
// because it also fakes element sizes -- this one only stops the ReferenceError.
// jsdom implements no PointerEvent at all, and @dnd-kit/dom's pointer sensor
// tests every event with `event instanceof PointerEvent` -- against undefined
// that is a TypeError, not a false. A constructor is all the guard needs: the
// mouse events tests dispatch are correctly not instances of it.
const anyWindow = global as unknown as {PointerEvent?: unknown}
if (!anyWindow.PointerEvent) {
    anyWindow.PointerEvent = class PointerEvent extends MouseEvent {}
}

const anyGlobal = global as unknown as {ResizeObserver?: unknown}
if (!anyGlobal.ResizeObserver) {
    anyGlobal.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
}

// jsdom does implement WebSocket, and that is the problem: a card rendered in a
// test subscribes to the agent event socket (components/acp/agentEvents), and
// jsdom would dial a server that is not there, fail after the test has finished
// and schedule a reconnect into the next one. A socket that connects to nothing
// is what every suite but agentEvents' own wants; that one installs a fake of
// its own over this.
class SilentWebSocket {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3

    readyState = SilentWebSocket.CONNECTING
    onopen: ((event: unknown) => void) | null = null
    onclose: ((event: unknown) => void) | null = null
    onerror: ((event: unknown) => void) | null = null
    onmessage: ((event: unknown) => void) | null = null

    constructor(public url: string) {}

    send() {}
    close() {
        this.readyState = SilentWebSocket.CLOSED
    }
    addEventListener() {}
    removeEventListener() {}
}

(global as unknown as {WebSocket: unknown}).WebSocket = SilentWebSocket

// A side-effect-only file is a global script under --isolatedModules; this makes
// it a module without changing what it does.
export {}
