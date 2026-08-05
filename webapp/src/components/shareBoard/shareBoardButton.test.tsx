// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render} from '@solidjs/testing-library'

import {BoardTypeOpen} from '../../blocks/board'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import ShareBoardButton from './shareBoardButton'

vi.useFakeTimers()

const boardId = '1'

const board = TestBlockFactory.createBoard()
board.id = boardId

describe('src/components/shareBoard/shareBoard', () => {
    const state = {
        boards: {
            boards: {
                [board.id]: board,
            },
            current: board.id,
        },
    }

    const store = mockAppStore(state)

    test('should match snapshot, Private Board', async () => {
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoardButton
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>))

        const renderer = result.container

        expect(renderer).toMatchSnapshot()
    })

    test('should match snapshot, Open Board', async () => {
        board.type = BoardTypeOpen
        const result = render(() =>
            wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <ShareBoardButton
                        enableSharedBoards={true}
                    />
                </AppStoreProvider>))

        const renderer = result.container

        expect(renderer).toMatchSnapshot()
    })
})
