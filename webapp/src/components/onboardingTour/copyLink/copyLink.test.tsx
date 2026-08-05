// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import {render} from '@solidjs/testing-library'



import {mockAppStore, wrapIntl} from '../../../testUtils'
import {AppStoreProvider} from '../../../store'

import CopyLinkTourStep from './copy_link'

describe('components/onboardingTour/addComments/CopyLinkTourStep', () => {
    const state = {
        users: {
            me: {
                id: 'user_id_1',
            },
            myConfig: {
                onboardingTourStarted: {value: true},
                tourCategory: {value: 'board'},
                onboardingTourStep: {value: '1'},
            },
        },
        boards: {
            boards: {
                board_id_1: {title: 'Welcome to Boards!'},
            },
            current: 'board_id_1',
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
                <CopyLinkTourStep/>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('after hover', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CopyLinkTourStep/>
            </AppStoreProvider>,
        )
        render(component)
        const elements = document.querySelectorAll('.CopyLinkTourStep')
        expect(elements.length).toBe(2)
        expect(elements[1]).toMatchSnapshot()
    })
})
