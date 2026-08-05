// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.


import {render} from '@solidjs/testing-library'


import {TestRouter, mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import GlobalHeader from './globalHeader'

describe('components/sidebar/GlobalHeader', () => {

    let store = mockAppStore({})
    beforeEach(() => {
        store = mockAppStore({})
    })
    test('header menu should match snapshot', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                <GlobalHeader history={history}/>
                </TestRouter>
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
