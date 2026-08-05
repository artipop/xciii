// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import userEvent from '@testing-library/user-event'

import {BoardView} from '../../blocks/boardView'

import {TestBlockFactory} from '../../test/testBlockFactory'

import mutator from '../../mutator'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {Constants} from '../../constants'

import ViewHeaderPropertiesMenu from './viewHeaderPropertiesMenu'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const board = TestBlockFactory.createBoard()
let activeView: BoardView

describe('components/viewHeader/viewHeaderPropertiesMenu', () => {
    const state = {
        users: {
            me: {
                id: 'user-id-1',
                username: 'username_1'},
        },
    }
    const store = mockAppStore(state)
    beforeEach(() => {
        vi.clearAllMocks()
        activeView = TestBlockFactory.createBoardView(board)
    })
    test('return properties menu', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderPropertiesMenu
                        activeView={activeView}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'Properties menu'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })
    test('return properties menu with gallery typeview', () => {
        activeView.fields.viewType = 'gallery'
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderPropertiesMenu
                        activeView={activeView}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getByRole('button', {name: 'Properties menu'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })
    test('show menu and verify the call for showing card badges', () => {
        render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderPropertiesMenu
                        activeView={activeView}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const menuButton = screen.getByRole('button', {name: 'Properties menu'})
        userEvent.click(menuButton)
        const badgesButton = screen.getByRole('button', {name: 'Comments and description'})
        userEvent.click(badgesButton)
        expect(mockedMutator.changeViewVisibleProperties).toHaveBeenCalledWith(
            activeView.boardId,
            activeView.id,
            activeView.fields.visiblePropertyIds,
            [...activeView.fields.visiblePropertyIds, Constants.badgesColumnId],
        )
    })
    test('show menu and verify that it is not closed after clicking on the item', () => {
        render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <ViewHeaderPropertiesMenu
                        activeView={activeView}
                        properties={board.cardProperties}
                    />
                </AppStoreProvider>,
            ),
        )
        const menuButton = screen.getByRole('button', {name: 'Properties menu'})
        userEvent.click(menuButton)

        const property1Button = screen.getByRole('button', {name: 'Property 1'})
        userEvent.click(property1Button)
        expect(property1Button).toBeInTheDocument()

        const property2Button = screen.getByRole('button', {name: 'Property 2'})
        userEvent.click(property2Button)
        expect(property2Button).toBeInTheDocument()

        expect(mockedMutator.changeViewVisibleProperties).toHaveBeenCalledTimes(2)
    })
})
