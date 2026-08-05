// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The flow canvas measures the page: it observes the container's size, reads a
// transform matrix off it, and asks whether the pointer is coarse. jsdom has
// none of ResizeObserver, DOMMatrix or matchMedia, and every element it lays
// out is 0×0, so without these the canvas throws instead of rendering. Kept
// here rather than in a global jest setup because faking element sizes for the
// whole suite would change what other tests see.
export function setupReactFlowEnvironment(): void {
    const anyGlobal = global as any

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

    // Node internals are re-measured off the critical path; a timeout is idle
    // enough for a test.
    if (!window.requestIdleCallback) {
        window.requestIdleCallback = (cb: IdleRequestCallback): number =>
            window.setTimeout(() => cb({didTimeout: false, timeRemaining: () => 50}), 0)
        window.cancelIdleCallback = (id: number): void => window.clearTimeout(id)
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
