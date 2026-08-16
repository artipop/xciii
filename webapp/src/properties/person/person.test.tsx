import {render, waitFor} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {IPropertyTemplate, Board} from '../../blocks/board'
import {Card} from '../../blocks/card'

import PersonProperty from './property'
import Person from './person'

describe('properties/person', () => {
    const state = {
        users: {
            boardUsers: {
                'user-id-1': {
                    id: 'user-id-1',
                    username: 'username-1',
                    email: 'user-1@example.com',
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

    test('not readOnly not existing user', async () => {
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Person
                    property={new PersonProperty()}
                    propertyValue={'user-id-2'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={{} as Board}
                    card={{} as Card}
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
    })

    test('not readonly', async () => {
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Person
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={{} as Board}
                    card={{} as Card}
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
    })

    test('not readonly guest user', async () => {
        const store = mockAppStore({...state, users: {boardUsers: {'user-id-1': {...state.users.boardUsers['user-id-1'], is_guest: true}}}})
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Person
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={{} as Board}
                    card={{} as Card}
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
    })

    test('readonly view', async () => {
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Person
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={true}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={{} as Board}
                    card={{} as Card}
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
    })

    test('user dropdown open', async () => {
        const store = mockAppStore(state)
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Person
                    property={new PersonProperty()}
                    propertyValue={'user-id-1'}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    board={{} as Board}
                    card={{} as Card}
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

        if (container) {
            // this is the actual element where the click event triggers
            // opening of the dropdown
            const userProperty = container.querySelector(".Person input[role='combobox']")
            expect(userProperty).not.toBeNull()

            userEvent.click(userProperty as Element)

            // The list arrives a tick later: the options are narrowed to the
            // agents the board names, and asking Go that is a promise.
            // Waited for as an option rather than by name: the one board user
            // is also the value, so the name is on screen before the list is.
            await waitFor(() => expect(container.querySelector('[role="option"]')).not.toBeNull())
            expect(container).toMatchSnapshot()
        } else {
            throw new Error('container should have been initialized')
        }
    })
})
