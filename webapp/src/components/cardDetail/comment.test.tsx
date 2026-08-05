// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import moment from 'moment'

import {mocked} from 'jest-mock'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import mutator from '../../mutator'

import Comment from './comment'

jest.mock('../../mutator')
const mockedMutator = mocked(mutator)

const board = TestBlockFactory.createBoard()
const card = TestBlockFactory.createCard(board)
const comment = TestBlockFactory.createComment(card)
const dateFixed = Date.parse('01 Oct 2020')
comment.createAt = dateFixed
comment.updateAt = dateFixed
comment.title = 'Test comment'

const userImageUrl = 'data:image/svg+xml'

describe('components/cardDetail/comment', () => {
    const state = {
        users: {
            boardUsers: {[comment.modifiedBy]: {username: 'username_1'}},
        },
    }
    const store = mockAppStore(state)

    beforeEach(() => {
        jest.clearAllMocks()
        moment.now = () => {
            return dateFixed + (24 * 60 * 60 * 1000)
        }
    })

    afterEach(() => {
        moment.now = () => {
            return Number(new Date())
        }
    })

    test('return comment', () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })

    test('return comment readonly', () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={true}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('return comment and delete comment', () => {
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonDelete = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonDelete)
        expect(mockedMutator.deleteBlock).toHaveBeenCalledTimes(1)
        expect(mockedMutator.deleteBlock).toHaveBeenCalledWith(comment)
    })

    test('return guest comment', () => {
        const localStore = mockAppStore({users: {boardUsers: {[comment.modifiedBy]: {username: 'username_1', is_guest: true}}}})
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={localStore}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })

    test('return guest comment readonly', () => {
        const localStore = mockAppStore({users: {boardUsers: {[comment.modifiedBy]: {username: 'username_1', is_guest: true}}}})
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={localStore}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={true}
                />
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    test('return guest comment and delete comment', () => {
        const localStore = mockAppStore({users: {boardUsers: {[comment.modifiedBy]: {username: 'username_1', is_guest: true}}}})
        const {container} = render(() => wrapIntl(() =>
            <AppStoreProvider store={localStore}>
                <Comment
                    comment={comment}
                    userId={comment.modifiedBy}
                    userImageUrl={userImageUrl}
                    readonly={false}
                />
            </AppStoreProvider>,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonDelete = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonDelete)
        expect(mockedMutator.deleteBlock).toHaveBeenCalledTimes(1)
        expect(mockedMutator.deleteBlock).toHaveBeenCalledWith(comment)
    })
})
