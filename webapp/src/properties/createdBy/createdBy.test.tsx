// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import {IUser} from '../../user'
import {createCard} from '../../blocks/card'
import {Board, IPropertyTemplate} from '../../blocks/board'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import CreatedByProperty from './property'
import CreatedBy from './createdBy'

describe('properties/createdBy', () => {
    test('should match snapshot', () => {
        const card = createCard()
        card.createdBy = 'user-id-1'
        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'} as IUser,
                },
            },
            clientConfig: {
                value: {
                    teammateNameDisplay: 'username',
                },
            },
        })

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CreatedBy
                    property={new CreatedByProperty()}
                    board={{} as Board}
                    card={card}
                    readOnly={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    propertyValue={''}
                    showEmptyPlaceholder={false}
                />
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot as guest', () => {
        const card = createCard()
        card.createdBy = 'user-id-1'
        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1', is_guest: true} as IUser,
                },
            },
            clientConfig: {
                value: {
                    teammateNameDisplay: 'username',
                },
            },
        })

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CreatedBy
                    property={new CreatedByProperty()}
                    board={{} as Board}
                    card={card}
                    readOnly={false}
                    propertyTemplate={{} as IPropertyTemplate}
                    propertyValue={''}
                    showEmptyPlaceholder={false}
                />
            </AppStoreProvider>,
        )

        const {container} = render(() => wrapIntl(component))
        expect(container).toMatchSnapshot()
    })
})
