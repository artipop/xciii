// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.



import {render} from '@solidjs/testing-library'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import RegistrationLink from './registrationLink'

describe('components/sidebar/RegistrationLink', () => {
    const state = {
        teams: {
            current: {
                id: 'team-id',
                signupToken: 'abc123',
            },
        },
    }

    test('renders with signupToken in URL query param', () => {
        const store = mockAppStore(state)

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <RegistrationLink
                    onClose={() => {}}
                />
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()

        const anchor = container.querySelector('.shareUrl')
        const url = new URL(anchor?.getAttribute('href') as string)
        expect(url.searchParams.get('t')).toStrictEqual(state.teams.current.signupToken)
    })
})
