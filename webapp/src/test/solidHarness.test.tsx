// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The migration rides on three toolchain facts: babel-jest compiles Solid JSX,
// jsdom resolves solid-js to its browser development build (customExportConditions
// in the jest config — the node build would render once and never react), and
// Portal escapes into document.body the way dialogs and menus expect. This suite
// fails on the config regression, before any component test gets to be confusing.

import {createSignal} from 'solid-js'
import {Portal} from 'solid-js/web'
import {render, fireEvent, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

const Counter = () => {
    const [count, setCount] = createSignal(0)
    return (
        <button onClick={() => setCount(count() + 1)}>
            {'clicks: '}{count()}
        </button>
    )
}

test('a signal update re-renders in jsdom', async () => {
    render(() => <Counter/>)
    const button = screen.getByRole('button')
    expect(button).toHaveTextContent('clicks: 0')
    fireEvent.click(button)
    expect(button).toHaveTextContent('clicks: 1')
})

test('Portal renders into document.body', () => {
    render(() => (
        <Portal>
            <div data-testid='ported'>{'outside the app root'}</div>
        </Portal>
    ))
    expect(screen.getByTestId('ported').parentElement?.parentElement).toBe(document.body)
})
