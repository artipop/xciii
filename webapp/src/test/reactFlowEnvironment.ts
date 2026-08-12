// The flow canvas measures the page: it observes the container's size, reads a
// transform matrix off it, and asks whether the pointer is coarse. jsdom has
// none of ResizeObserver, DOMMatrix or matchMedia, and every element it lays
// out is 0×0, so without these the canvas throws instead of rendering. Kept
// here rather than in a global setup file because faking element sizes for the
// whole suite would change what other tests see.

import {installPolyfills} from '../polyfills'

export function setupReactFlowEnvironment(): void {
    const anyGlobal = global as any

    // requestIdleCallback is missing from jsdom for the same reason it is
    // missing from the app's own webview, so the app's shim is what tests get
    // rather than a second one that could drift from it.
    installPolyfills()

    if (!window.matchMedia) {
        window.matchMedia = (query: string): MediaQueryList => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        } as MediaQueryList)
    }

    if (!anyGlobal.ResizeObserver) {
        anyGlobal.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
    }

    if (!anyGlobal.DOMMatrixReadOnly) {
        anyGlobal.DOMMatrixReadOnly = class {
            m22: number
            constructor(transform: string) {
                const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1]
                this.m22 = scale === undefined ? 1 : Number(scale)
            }
        }
    }

    // A node with no size is a node React Flow refuses to place. Redefining a
    // prototype property twice throws, so this half runs once per process.
    if (!anyGlobal.reactFlowSizedElements) {
        anyGlobal.reactFlowSizedElements = true
        Object.defineProperties(global.HTMLElement.prototype, {
            offsetHeight: {get() {
                return parseFloat(this.style.height) || 1
            }},
            offsetWidth: {get() {
                return parseFloat(this.style.width) || 1
            }},
        })
        anyGlobal.SVGElement.prototype.getBBox = () => ({x: 0, y: 0, width: 0, height: 0})
    }
}
