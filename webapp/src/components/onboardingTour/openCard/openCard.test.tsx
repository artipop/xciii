// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import {render} from '@solidjs/testing-library'



import {mockAppStore, wrapIntl} from '../../../testUtils'
import {AppStoreProvider} from '../../../store'

import OpenCardTourStep from './open_card'

describe('components/onboardingTour/addComments/OpenCardTourStep', () => {
    const state = {
        users: {
            me: {
                id: 'user_id_1',
            },
            myConfig: {
                onboardingTourStarted: {value: true},
                tourCategory: {value: 'onboarding'},
                onboardingTourStep: {value: '0'},
            },
        },
        boards: {
            boards: {
                board_id_1: {title: 'Welcome to Boards!'},
            },
            current: 'board_id_1',
        },
        cards: {
            cards: {
                card_id_1: {title: 'Create a new card'},
            },
            current: 'card_id_1',
        },
        clientConfig: {
            value: {},
        },
    }
    let store = mockAppStore(state)

    beforeEach(() => {
        store = mockAppStore(state)
    })

    test('before hover', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <OpenCardTourStep/>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('after hover', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <OpenCardTourStep/>
            </AppStoreProvider>,
        )
        render(component)
        const elements = document.querySelectorAll('.OpenCardTourStep')
        expect(elements.length).toBe(2)
        expect(elements[1]).toMatchSnapshot()
    })
})
