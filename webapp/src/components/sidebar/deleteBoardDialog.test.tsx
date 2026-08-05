// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal} from 'solid-js'

import userEvent from '@testing-library/user-event'
import {render} from '@solidjs/testing-library'

import {IntlProvider} from '../../intl'

import DeleteBoardDialog from './deleteBoardDialog'

describe('components/sidebar/DeleteBoardDialog', () => {
    it('Cancel should not submit', async () => {
        const container = renderTest()

        const cancelButton = container.querySelector('.dialog .footer button:not(.danger)')
        expect(cancelButton).not.toBeFalsy()
        expect(cancelButton?.textContent).toBe('Cancel')
        userEvent.click(cancelButton as Element)

        expect(container).toMatchSnapshot()
    })

    it('Delete should submit', async () => {
        const container = renderTest()

        const deleteButton = container.querySelector('.dialog .footer button.danger')
        expect(deleteButton).not.toBeFalsy()
        expect(deleteButton?.textContent).toBe('Delete')
        userEvent.click(deleteButton as Element)

        expect(container).toMatchSnapshot()
    })

    function renderTest() {
        const rootPortalDiv = document.createElement('div')
        rootPortalDiv.id = 'xciii-root-portal'

        const {container} = render(() => <TestComponent/>, {container: document.body.appendChild(rootPortalDiv)})
        return container
    }

    function TestComponent() {
        const [isDeleted, setDeleted] = createSignal(false)
        const [isOpen, setOpen] = createSignal(true)

        return (
            <IntlProvider
                locale='en'
                messages={{}}
            >
                {isDeleted() ? 'deleted' : 'exists'}
                <Show when={isOpen()}>
                    <DeleteBoardDialog
                        boardTitle={'Delete'}
                        onClose={() => setOpen(false)}
                        onDelete={async () => setDeleted(true)}
                    />
                </Show>
            </IntlProvider>
        )
    }
})
