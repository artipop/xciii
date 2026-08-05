// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import '@testing-library/jest-dom'
import {render, screen, fireEvent} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {mocked} from 'jest-mock'

import mutator from '../mutator'
import {Utils} from '../utils'
import {TestBlockFactory} from '../test/testBlockFactory'
import {mockAppStore, mockDOM, wrapIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import ViewTitle from './viewTitle'

jest.mock('../mutator')
jest.mock('../utils')

const mockedMutator = mocked(mutator)
const mockedUtils = mocked(Utils)
mockedUtils.createGuid.mockReturnValue('test-id')

beforeAll(() => {
    mockDOM()
})

describe('components/viewTitle', () => {
    const board = TestBlockFactory.createBoard()
    board.id = 'test-id'
    const state = {
        users: {
            boardUsers: {
                1: {username: 'abc'},
                2: {username: 'd'},
                3: {username: 'e'},
                4: {username: 'f'},
                5: {username: 'g'},
            },
        },
        teams: {
            current: {id: 'team-id'},
        },
        boards: {
            current: board.id,
            boards: {
                [board.id]: board,
            },
            myBoardMemberships: {
                [board.id]: {userId: 'user_id_1', schemeAdmin: true},
            },
        },
        clientConfig: {
            value: {},
        },
    }
    const store = mockAppStore(state)

    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('should match snapshot', async () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot readonly', async () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={true}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('show description', async () => {
        board.showDescription = true
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
        const hideDescriptionButton = screen.getAllByRole('button')[0]
        userEvent.click(hideDescriptionButton)
        expect(mockedMutator.showBoardDescription).toHaveBeenCalledTimes(1)
    })

    test('hide description', async () => {
        board.showDescription = false
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
        const showDescriptionButton = screen.getAllByRole('button')[0]
        userEvent.click(showDescriptionButton)
        expect(mockedMutator.showBoardDescription).toHaveBeenCalledTimes(1)
    })

    test('add random icon', async () => {
        board.icon = ''
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
        const randomIconButton = screen.getAllByRole('button')[0]
        userEvent.click(randomIconButton)
        expect(mockedMutator.changeBoardIcon).toHaveBeenCalledTimes(1)
    })

    test('change title', async () => {
        render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ViewTitle
                    board={board}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const titleInput = screen.getAllByRole('textbox')[0]
        userEvent.type(titleInput, 'other title')
        fireEvent.blur(titleInput)
        expect(mockedMutator.changeBoardTitle).toHaveBeenCalledTimes(1)
    })
})
