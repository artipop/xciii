// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@solidjs/testing-library'

import {wrapIntl} from '../../testUtils'

import DividerElement from './dividerElement'

describe('components/content/DividerElement', () => {
    test('should match snapshot', async () => {
        const component = () => wrapIntl(() =><DividerElement/>)
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
