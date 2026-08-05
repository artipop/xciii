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

import ViewHeaderSortMenu from './viewHeaderSortMenu'

jest.mock('../../mutator')
const mockedMutator = mocked(mutator)

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)
const cards = [TestBlockFactory.createCard(board), TestBlockFactory.createCard(board)]

describe('components/viewHeader/viewHeaderSortMenu', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
    }
    const store = mockAppStore(state)
    beforeEach(() => {
        jest.clearAllMocks()
    })
    test('return sort menu', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderSortMenu
                        activeView={activeView}
                        orderedCards={cards}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })
    test('return sort menu and do manual', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderSortMenu
                        activeView={activeView}
                        orderedCards={cards}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonManual = screen.getByRole('button', {name: 'Manual'})
        userEvent.click(buttonManual)
        expect(container).toMatchSnapshot()
        expect(mockedMutator.updateBlock).toHaveBeenCalledTimes(1)
    })
    test('return sort menu and do revert', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderSortMenu
                        activeView={activeView}
                        orderedCards={cards}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonRevert = screen.getByRole('button', {name: 'Revert'})
        userEvent.click(buttonRevert)
        expect(container).toMatchSnapshot()
        expect(mockedMutator.changeViewSortOptions).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeViewSortOptions).toHaveBeenCalledWith(activeView.boardId, activeView.id, activeView.fields.sortOptions, [])
    })
    test('return sort menu and do Name sort', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderSortMenu
                        activeView={activeView}
                        orderedCards={cards}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonName = screen.getByRole('button', {name: 'Name'})
        userEvent.click(buttonName)
        expect(container).toMatchSnapshot()
        expect(mockedMutator.changeViewSortOptions).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeViewSortOptions).toHaveBeenCalledWith(activeView.boardId, activeView.id, activeView.fields.sortOptions, [{propertyId: '__title', reversed: false}])
    })
})
