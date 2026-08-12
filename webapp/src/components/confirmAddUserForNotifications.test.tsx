import '@testing-library/jest-dom'
import {render, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {MemberRole} from '../blocks/board'

import {wrapDNDIntl} from '../testUtils'
import {IUser} from '../user'

import ConfirmAddUserForNotifications from './confirmAddUserForNotifications'

describe('/components/confirmAddUserForNotifications', () => {
    it('should match snapshot', async () => {
        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={true}
                    minimumRole={MemberRole.Editor}
                    user={{id: 'fake-user-id', username: 'fake-username'} as IUser}
                    onConfirm={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )
        expect(result.container).toMatchSnapshot()
    })

    it('confirm button click, run onConfirm Function once', () => {
        const onConfirm = vi.fn()

        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={true}
                    minimumRole={MemberRole.Editor}
                    user={{id: 'fake-user-id', username: 'fake-username'} as IUser}
                    onConfirm={onConfirm}
                    onClose={vi.fn()}
                />,
            ),
        )
        userEvent.click(result.getByTitle('Add to board'))
        expect(onConfirm).toHaveBeenCalledTimes(1)
    })

    it('cancel button click runs onClose function', () => {
        const onClose = vi.fn()

        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={true}
                    minimumRole={MemberRole.Editor}
                    user={{id: 'fake-user-id', username: 'fake-username'} as IUser}
                    onConfirm={vi.fn()}
                    onClose={onClose}
                />,
            ),
        )
        userEvent.click(result.getByTitle('Cancel'))
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    // An agent is not a person being invited: it reads nothing, is notified of
    // nothing, and does its work through our own API under a grant that has
    // nothing to do with this membership. Asking what permission to give it is
    // a question with no meaningful answer — and «Наблюдатель» was the one it
    // defaulted to, which is the opposite of what an agent is for.
    it('asks an agent no permission and adds it as an editor', async () => {
        const onConfirm = vi.fn();
        (window as any).go = {main: {App: {
            ListAgentAccounts: vi.fn().mockResolvedValue(JSON.stringify([{name: 'clava', username: 'clava'}])),
        }}}

        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={true}
                    minimumRole={MemberRole.Viewer}
                    user={{id: 'agent-user-id', username: 'clava'} as IUser}
                    onConfirm={onConfirm}
                    onClose={vi.fn()}
                />,
            ),
        )

        await waitFor(() => expect(result.container.querySelector('.permissions-title')).toBeNull())
        expect(result.queryByText('Permissions')).toBeNull()

        userEvent.click(result.getByTitle('Add to board'))
        await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('agent-user-id', MemberRole.Editor))

        delete (window as any).go
    })

    // And a person is still asked, which is the whole reason the dialog exists.
    it('still asks a person which permission to give', async () => {
        (window as any).go = {main: {App: {
            ListAgentAccounts: vi.fn().mockResolvedValue('[]'),
        }}}

        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmAddUserForNotifications
                    allowManageBoardRoles={true}
                    minimumRole={MemberRole.Viewer}
                    user={{id: 'fake-user-id', username: 'fake-username'} as IUser}
                    onConfirm={vi.fn()}
                    onClose={vi.fn()}
                />,
            ),
        )

        expect(result.getByText('Permissions')).toBeInTheDocument()
        delete (window as any).go
    })
})
