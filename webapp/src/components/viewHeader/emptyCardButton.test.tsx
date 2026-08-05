// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {mocked} from 'jest-mock'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import mutator from '../../mutator'

import EmptyCardButton from './emptyCardButton'

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)

jest.mock('../../mutator')
const mockedMutator = mocked(mutator)
describe('components/viewHeader/emptyCardButton', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
        },
        views: {
            current: 0,
            views: [activeView],
        },
    }

    const store = mockAppStore(state)
    const mockFunction = jest.fn()

    beforeEach(() => {
        jest.clearAllMocks()
    })
    test('return EmptyCardButton', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <EmptyCardButton
                        addCard={mockFunction}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })
    test('return EmptyCardButton and addCard', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <EmptyCardButton
                        addCard={mockFunction}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
        const buttonEmpty = screen.getByRole('button', {name: 'Empty card'})
        userEvent.click(buttonEmpty)
        expect(mockFunction).toHaveBeenCalledTimes(1)
    })
    test('return EmptyCardButton and Set Template', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <EmptyCardButton
                        addCard={mockFunction}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonDefault = screen.getByRole('button', {name: 'Set as default'})
        userEvent.click(buttonDefault)
        expect(mockedMutator.clearDefaultTemplate).toHaveBeenCalledTimes(1)
    })
})
