import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'

import userEvent from '@testing-library/user-event'

import {wrapIntl} from '../testUtils'

import {FlashMessages, sendFlashMessage} from './flashMessages'

vi.mock('../mutator')

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.clearAllTimers()
})

describe('components/flashMessages', () => {
    test('renders a flash message with high severity', () => {
        const {container} = render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        /**
         * Check for high severity
         */

        sendFlashMessage({content: 'Mock Content', severity: 'high'})

        expect(container).toMatchSnapshot()

        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Mock Content')).toBeNull()
    })

    test('renders a flash message with normal severity', () => {
        const {container} = render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Mock Content', severity: 'normal'})

        expect(screen.getByText('Mock Content')).toHaveClass('normal')

        expect(container).toMatchSnapshot()

        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Mock Content')).toBeNull()
    })

    test('renders a flash message with low severity', () => {
        const {container} = render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Mock Content', severity: 'low'})

        expect(screen.getByText('Mock Content')).toHaveClass('low')

        expect(container).toMatchSnapshot()

        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Mock Content')).toBeNull()
    })

    test('renders a flash message with low severity and custom HTML in flash message', () => {
        const {container} = render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: <div data-testid='mock-test-id'>{'Mock Content'}</div>, severity: 'low'})

        expect(screen.getByTestId('mock-test-id')).toBeVisible()

        expect(container).toMatchSnapshot()

        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Mock Content')).toBeNull()
    })

    // A notice outlives the mount-wide default: the wizard's parting note has a
    // three-menu path in it, and 2 seconds is not enough to read one.
    test('a notice stays up for its own time, not the default', () => {
        render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Come back any time', severity: 'normal', notice: true, milliseconds: 5000})

        vi.advanceTimersByTime(1000)
        expect(screen.getByText('Come back any time')).toBeVisible()

        vi.advanceTimersByTime(4000)
        expect(screen.queryByText('Come back any time')).toBeNull()
    })

    // The × is for whoever has already read it — the message must not make
    // them wait the five seconds out.
    test('a notice carries a close button that dismisses it', () => {
        render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Come back any time', severity: 'normal', notice: true, milliseconds: 5000})

        userEvent.click(screen.getByRole('button', {name: 'Close'}))
        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Come back any time')).toBeNull()
    })

    // The quick confirmations stay what they were: no close button on them.
    test('a plain flash has no close button', () => {
        render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Copied!', severity: 'normal'})

        expect(screen.queryByRole('button', {name: 'Close'})).toBeNull()
    })

    test('renders a flash message with low severity and check onClick on flash works', () => {
        const {container} = render(() =>
            wrapIntl(() => <FlashMessages milliseconds={200}/>),
        )

        sendFlashMessage({content: 'Mock Content', severity: 'low'})

        userEvent.click(screen.getByText('Mock Content'))

        expect(container).toMatchSnapshot()

        vi.advanceTimersByTime(200)

        expect(screen.queryByText('Mock Content')).toBeNull()
    })
})
