// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render} from '@solidjs/testing-library'

import {wrapDNDIntl} from '../testUtils'
import {Constants} from '../constants'

import TopBar from './topBar'

Object.defineProperty(Constants, 'versionString', {value: '1.0.0'})
vi.mock('../utils')

describe('src/components/topBar', () => {
    beforeEach(vi.resetAllMocks)
    test('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <TopBar/>,
        ))
        expect(container).toMatchSnapshot()
    })
})
