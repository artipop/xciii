// The browser this app ships in is WKWebView — the desktop window is one and so
// is the phone — and it is not the browser its libraries were written against.
// What lives here is a function some dependency calls unconditionally and Safari
// does not have; each one is a ReferenceError that takes a whole feature down,
// so they are installed before anything else runs.

// Solid Flow re-measures a node's internals inside a requestIdleCallback, on
// mount and after every resize. Without it the flow canvas dies with
// «ReferenceError: Can't find variable: requestIdleCallback» — the route in the
// workflows dialog, the strip on a card, the map of the board — while the same
// page is fine in Chrome, which is where it was written.
//
// A timeout is the shim everyone uses: the callback is not urgent (it is a
// measurement, and the canvas draws from stated geometry until it arrives), so
// the next tick is idle enough.
//
// TODO.md says how to find out whether this is still needed — a shim that
// outlives its gap hides what the browser actually does now.
export function installPolyfills(): void {
    const anyWindow = window as any

    if (typeof anyWindow.requestIdleCallback !== 'function') {
        anyWindow.requestIdleCallback = (callback: IdleRequestCallback): number =>
            window.setTimeout(() => callback({
                didTimeout: false,
                timeRemaining: () => 50,
            } as IdleDeadline), 1)
        anyWindow.cancelIdleCallback = (handle: number): void => window.clearTimeout(handle)
    }
}
