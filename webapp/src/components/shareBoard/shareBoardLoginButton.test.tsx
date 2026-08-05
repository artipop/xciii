// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render} from '@solidjs/testing-library'
import {MemoryRouter, Route, createMemoryHistory} from '@solidjs/router'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {wrapDNDIntl} from '../../testUtils'

import ShareBoardLoginButton from './shareBoardLoginButton'
jest.useFakeTimers()

const boardId = '1'

const board = TestBlockFactory.createBoard()
board.id = boardId

describe('src/components/shareBoard/shareBoardLoginButton', () => {
    const savedLocation = window.location

    afterEach(() => {
        window.location = savedLocation as string & Location
    })

    test('should match snapshot', async () => {
        window.location = Object.assign(new URL('https://example.org/mattermost'))
        const history = createMemoryHistory()
        history.set({value: '/team1/boardId1/viewId1/cardId1'})
        const result = render(() =>
            wrapDNDIntl(() =>
                <MemoryRouter history={history}>
                    <Route
                        path='/:teamId/:boardId?/:viewId?/:cardId?'
                        component={ShareBoardLoginButton}
                    />
                </MemoryRouter>,
            ))
        const renderer = result.container

        expect(renderer).toMatchSnapshot()
    })
})
