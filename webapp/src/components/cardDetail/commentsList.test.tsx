// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import 'isomorphic-fetch'

import {render} from '@solidjs/testing-library'

import {CommentBlock} from '../../blocks/commentBlock'

import {mockAppStore, mockDOM, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {Utils} from '../../utils'

import {FetchMock} from '../../test/fetchMock'

import CommentsList from './commentsList'

global.fetch = FetchMock.fn
jest.spyOn(Utils, 'displayDateTime').mockReturnValue('a long time ago')
jest.spyOn(Utils, 'relativeDisplayDateTime').mockReturnValue('a long time ago')

beforeEach(() => {
    FetchMock.fn.mockReset()
})

beforeAll(() => {
    mockDOM()
})

describe('components/cardDetail/CommentsList', () => {
    const createdAt = Date.parse('01 Jan 2021 00:00:00 GMT')
    const comment1: CommentBlock = {
        id: 'comment_id_1',
        title: 'Comment 1',
        createAt: createdAt,
        modifiedBy: 'user_id_1',
    } as CommentBlock

    const comment2: CommentBlock = {
        id: 'comment_id_2',
        title: 'Comment 2',
        createAt: createdAt,
        modifiedBy: 'user_id_2',
    } as CommentBlock

    test('comments show up', async () => {
        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            boards: {
                boards: {
                    board_id_1: {title: 'Board'},
                },
                current: 'board_id_1',
                myBoardMemberships: {
                    board_id_1: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            cards: {
                cards: {
                    card_id_1: {title: 'Card'},
                },
                current: 'card_id_1',
            },
            clientConfig: {
                value: {},
            },
            teams: {
                current: {id: 'team_id_1'},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CommentsList
                        comments={[comment1, comment2]}
                        cardId={'card_id'}
                        boardId={'board_id'}
                        readonly={false}
                    />,
                )}
            </AppStoreProvider>)

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()
        expect(container).toMatchSnapshot()

        // Comments show up
        const comments = container!.querySelectorAll('.comment-text')
        expect(comments.length).toBe(2)

        // Add comment option visible when readonly mode is off
        const newCommentSection = container!.querySelectorAll('.newcomment')
        expect(newCommentSection.length).toBe(1)
    })

    test('comments show up in readonly mode', async () => {
        const store = mockAppStore({
            users: {
                boardUsers: {
                    'user-id-1': {username: 'username_1'},
                },
            },
            boards: {
                boards: {
                    board_id_1: {title: 'Board'},
                },
                current: 'board_id_1',
                myBoardMemberships: {
                    board_id_1: {userId: 'user_id_1', schemeAdmin: true},
                },
            },
            teams: {
                current: {id: 'team_id_1'},
            },
        })

        const component = () => (
            <AppStoreProvider store={store}>
                {wrapIntl(() =>
                    <CommentsList
                        comments={[comment1, comment2]}
                        cardId={'card_id'}
                        boardId={'board_id'}
                        readonly={true}
                    />,
                )}
            </AppStoreProvider>)

        let container: Element | DocumentFragment | null = null

        const result = render(component)
        container = result.container

        expect(container).toBeDefined()
        expect(container).toMatchSnapshot()

        // Comments show up
        const comments = container!.querySelectorAll('.comment-text')
        expect(comments.length).toBe(2)

        // Add comment option visible when readonly mode is off
        const newCommentSection = container!.querySelectorAll('.newcomment')
        expect(newCommentSection.length).toBe(0)
    })
})
