import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl, wrapStore} from './testUtils'
import FocalboardRouter from './router'

// The board's own routes end in a catch-all — /:boardId?/:viewId?/:cardId? —
// which is exactly the shape a path like /m falls into. If the ranking ever
// changed, a phone would silently get an empty board instead of the page
// written for it, and nothing else in the suite would notice.

vi.mock('./pages/boardPage/boardPage', () => ({default: () => <div>{'the board'}</div>}))
vi.mock('./pages/mobile/mobilePage', () => ({default: () => <div>{'the phone page'}</div>}))
vi.mock('./components/acp/terminalPage', () => ({default: () => <div>{'the terminal'}</div>}))
vi.mock('./pages/share/sharePage', () => ({default: () => <div>{'the share dialog'}</div>}))
vi.mock('./pages/welcome/welcomePage', () => ({default: () => <div>{'the welcome screen'}</div>}))

// Somebody who has been greeted already, which is everyone but a fresh install
// — otherwise every route below would be answered by the welcome screen.
const welcomed = {welcomePageViewed: {value: '1'}}

const renderAt = (path: string, myConfig: Record<string, unknown> = welcomed) => {
    window.history.pushState({}, '', path)
    const store = mockAppStore({users: {me: {id: 'user-1', username: 'u'} as any, myConfig: myConfig as any}})
    return render(() => wrapStore(store, () => wrapIntl(() => <FocalboardRouter/>)))
}

describe('router', () => {
    afterEach(() => window.history.pushState({}, '', '/'))

    it('gives /m the page written for a phone, not the board', async () => {
        renderAt('/m')

        expect(await screen.findByText('the phone page')).toBeInTheDocument()
    })

    it('gives /m/terminal/:id the terminal', async () => {
        renderAt('/m/terminal/term-1')

        expect(await screen.findByText('the terminal')).toBeInTheDocument()
    })

    // /share falls into the same catch-all, and it is opened by the system's
    // share sheet — where an empty board instead of the dialog would be a
    // feature that silently stopped existing.
    it('gives /share the share dialog, not the board', async () => {
        renderAt('/share')

        expect(await screen.findByText('the share dialog')).toBeInTheDocument()
    })

    it('still gives a board id the board', async () => {
        renderAt('/79dfb64e-9a41-4d69-9e0e-27dfd4f5f9d3')

        expect(await screen.findByText('the board')).toBeInTheDocument()
    })

    // The welcome screen is shown once and then never again, which is a fact
    // about the person: welcomePageViewed is a preference the board server
    // keeps, so a second window does not greet somebody twice.
    it('greets somebody who has never been greeted, on their way to a board', async () => {
        renderAt('/79dfb64e-9a41-4d69-9e0e-27dfd4f5f9d3', {})

        expect(await screen.findByText('the welcome screen')).toBeInTheDocument()
    })

    // The phone, the share dialog and the terminal are windows opened to do one
    // thing. A greeting in front of any of them is a window that did not do it.
    it.each([
        ['/m', 'the phone page'],
        ['/share', 'the share dialog'],
        ['/m/terminal/term-1', 'the terminal'],
    ])('does not greet anybody at %s', async (path, shown) => {
        renderAt(path, {})

        expect(await screen.findByText(shown)).toBeInTheDocument()
    })
})
