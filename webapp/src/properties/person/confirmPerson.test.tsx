import {render, screen, waitFor, within} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {IPropertyTemplate} from '../../blocks/board'

import client from '../../octoClient'

import mutator from '../../mutator'

import PersonProperty from './property'

// import {IPropertyTemplate, Board} from '../blocks/board'

import ConfirmPerson from './confirmPerson'
vi.mock('../../mutator')
vi.mock('../../octoClient')

const mockedMutator = vi.mocked(mutator)
const mockedOctoClient = vi.mocked(client)

const board = TestBlockFactory.createBoard()
board.teamId = 'team-id-1'
const card = TestBlockFactory.createCard(board)

describe('properties/person', () => {
    const state = {
        boards: {
            boards: {
                [board.id]: board,
            },
            current: board.id,
            myBoardMemberships: {
                [board.id]: {userId: 'user-id-1', schemeAdmin: true},
            },
        },
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1',
                roles: 'system_user',
            },
            boardUsers: {
                'user-id-1': {
                    id: 'user-id-1',
                    username: 'username-1',
                    email: 'user-1@example.com',
                    firstname: 'test',
                    lastname: 'user',
                    props: {},
                    create_at: 1621315184,
                    update_at: 1621315184,
                    delete_at: 0,
                },
                'user-id-2': {
                    id: 'user-id-2',
                    username: 'username-2',
                    email: 'user-2@example.com',
                    props: {},
                    create_at: 1621315184,
                    update_at: 1621315184,
                    delete_at: 0,
                },
                'user-id-3': {
                    id: 'user-id-3',
                    username: 'username-3',
                    email: 'user-3@example.com',
                    props: {},
                    create_at: 1621315184,
                    update_at: 1621315184,
                    delete_at: 0,
                },
            },
        },
        clientConfig: {
            value: {
                teammateNameDisplay: 'username',
            },
        },
    }
    const additionalUsers = [
        {
            id: 'user-id-4',
            username: 'username-4',
            email: 'user-4@example.com',
            nickname: '',
            firstname: '',
            lastname: '',
            props: {},
            create_at: 1621315184,
            update_at: 1621315184,
            delete_at: 0,
            is_bot: false,
            is_guest: false,
            roles: 'system_user',
        },
        {
            id: 'user-id-5',
            username: 'username-5',
            email: 'user-5@example.com',
            nickname: '',
            firstname: '',
            lastname: '',
            props: {},
            create_at: 1621315184,
            update_at: 1621315184,
            delete_at: 0,
            is_bot: false,
            is_guest: false,
            roles: 'system_user',
        },
    ]

    mockedOctoClient.searchTeamUsers.mockResolvedValue(additionalUsers)

    test('select user - confirm', async () => {
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ConfirmPerson
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={board}
                    card={card}
                />
            </AppStoreProvider>,
        )
        const renderResult = render(component)
        const container = await waitFor(() => {
            if (!renderResult.container) {
                return Promise.reject(new Error('container not found'))
            }
            return Promise.resolve(renderResult.container)
        })
        expect(container).toMatchSnapshot()

        if (container) {
            // this is the actual element where the click event triggers
            // opening of the dropdown
            const userProperty = container.querySelector(".Person input[role='combobox']")
            expect(userProperty).not.toBeNull()

            userEvent.click(userProperty as Element)

            // The list arrives a tick later: the options are narrowed to the
            // agents the board names, and asking Go that is a promise.
            await waitFor(() => expect(renderResult.getByText('username-4')).not.toBeNull())
            expect(container).toMatchSnapshot()

            const option = renderResult.getByText('username-4')
            expect(option).not.toBeNull()
            userEvent.click(option as Element)

            const confirmDialog = screen.getByTitle('Confirmation dialog')
            expect(confirmDialog).toBeDefined()
            const confirmButton = within(confirmDialog).getByRole('button', {name: 'Add to board'})
            expect(confirmButton).toBeDefined()
            userEvent.click(confirmButton)

            expect(mockedMutator.createBoardMember).toHaveBeenCalled()
        } else {
            throw new Error('container should have been initialized')
        }
    })

    test('select user - cancel', async () => {
        mockedMutator.createBoardMember.mockClear()
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ConfirmPerson
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={board}
                    card={card}
                />
            </AppStoreProvider>,
        )
        const renderResult = render(component)
        const container = await waitFor(() => {
            if (!renderResult.container) {
                return Promise.reject(new Error('container not found'))
            }
            return Promise.resolve(renderResult.container)
        })
        expect(container).toMatchSnapshot()

        if (container) {
            // this is the actual element where the click event triggers
            // opening of the dropdown
            const userProperty = container.querySelector(".Person input[role='combobox']")
            expect(userProperty).not.toBeNull()

            userEvent.click(userProperty as Element)

            // The list arrives a tick later: the options are narrowed to the
            // agents the board names, and asking Go that is a promise.
            await waitFor(() => expect(renderResult.getByText('username-4')).not.toBeNull())
            expect(container).toMatchSnapshot()

            const option = renderResult.getByText('username-4')
            expect(option).not.toBeNull()
            userEvent.click(option as Element)

            const confirmDialog = screen.getByTitle('Confirmation dialog')
            expect(confirmDialog).toBeDefined()
            const cancelButton = within(confirmDialog).getByRole('button', {name: 'Cancel'})
            expect(cancelButton).toBeDefined()
            userEvent.click(cancelButton)

            expect(mockedMutator.createBoardMember).not.toHaveBeenCalled()
        } else {
            throw new Error('container should have been initialized')
        }
    })

    // The registry is the machine's, so every agent registered anywhere has an
    // account on every board. What a board says about who works on it is the
    // crew of its columns, and the assignee list is narrowed to that: an agent
    // this board does not name is not offered, and a person is untouched.
    test('a board that names its agents offers those and no other', async () => {
        const anyWindow = window as any
        anyWindow.go = {main: {App: {
            BoardAgentUsers: vi.fn().mockResolvedValue(JSON.stringify({
                board: ['username-4'],
                all: ['username-4', 'username-5'],
            })),
        }}}

        const store = mockAppStore(state)
        const renderResult = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ConfirmPerson
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={board}
                    card={card}
                />
            </AppStoreProvider>,
        ))

        const userProperty = renderResult.container.querySelector(".Person input[role='combobox']")
        userEvent.click(userProperty as Element)

        await waitFor(() => expect(renderResult.getByText('username-4')).not.toBeNull())
        expect(renderResult.queryByText('username-5')).toBeNull()

        // A person is not an agent and is offered whatever the board names.
        expect(renderResult.getByText('username-1')).not.toBeNull()

        delete anyWindow.go
    })
})
