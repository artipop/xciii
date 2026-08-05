// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

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
