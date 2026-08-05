// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import '@testing-library/jest-dom'
import {render, screen} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import {Utils} from '../utils'
import {TestBlockFactory} from '../test/testBlockFactory'
import {mockAppStore, mockDOM, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import mutator from '../mutator'

import octoClient from '../octoClient'

import ContentBlock from './contentBlock'
import {CardDetailContext, CardDetailContextType} from './cardDetail/cardDetailContext'

vi.mock('../mutator')
vi.mock('../utils')
vi.mock('../octoClient')

beforeAll(mockDOM)

describe('components/contentBlock', () => {
    const mockedMutator = vi.mocked(mutator)
    const mockedUtils = vi.mocked(Utils)
    const mockedOcto = vi.mocked(octoClient)

    mockedUtils.createGuid.mockReturnValue('test-id')
    mockedOcto.getFileAsDataUrl.mockResolvedValue({url: 'test.jpg'})

    const board = TestBlockFactory.createBoard()
    board.cardProperties = []
    board.id = 'board-id'
    const boardView = TestBlockFactory.createBoardView(board)
    boardView.id = board.id
    const card = TestBlockFactory.createCard(board)
    card.id = board.id
    card.createdBy = 'user-id-1'
    const textBlock = TestBlockFactory.createText(card)
    textBlock.id = 'textBlock-id'
    const dividerBlock = TestBlockFactory.createDivider(card)
    dividerBlock.id = 'dividerBlock-id'
    const imageBlock = TestBlockFactory.createImage(card)
    imageBlock.fields.fileId = 'test.jpg'
    imageBlock.id = 'imageBlock-id'
    const commentBlock = TestBlockFactory.createComment(card)
    commentBlock.id = 'commentBlock-id'

    card.fields.contentOrder = [textBlock.id, dividerBlock.id, commentBlock.id]
    const cardDetailContextValue = (autoAdded: boolean): CardDetailContextType => ({
        card,
        lastAddedBlock: {
            id: textBlock.id,
            autoAdded,
        },
        deleteBlock: vi.fn(),
        addBlock: vi.fn(),
    })

    const board1 = TestBlockFactory.createBoard()
    board1.id = 'board-id-1'

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
        boards: {
            current: 'board-id-1',
            boards: {
                [board1.id]: board1,
            },
        },
        clientConfig: {
            value: {},
        },
    }
    const store = mockAppStore(state)

    const wrap = (child: () => JSX.Element): JSX.Element => (
        wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardDetailContext.Provider value={cardDetailContextValue(true)}>
                    {child()}
                </CardDetailContext.Provider>
            </AppStoreProvider>,
        )
    )

    beforeEach(vi.clearAllMocks)

    test('should match snapshot with textBlock', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={textBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with dividerBlock', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={dividerBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with commentBlock', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with imageBlock', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={imageBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with commentBlock readonly', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={true}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('return commentBlock and click on menuwrapper', async () => {
        const {container} = render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)

        expect(container).toMatchSnapshot()
    })

    test('return commentBlock and click move up', async () => {
        render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonMoveUp = screen.getByRole('button', {name: 'Move up'})
        userEvent.click(buttonMoveUp)
        expect(mockedUtils.arrayMove).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeCardContentOrder).toHaveBeenCalledTimes(1)
    })

    test('return commentBlock and click move down', async () => {
        render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonMoveUp = screen.getByRole('button', {name: 'Move down'})
        userEvent.click(buttonMoveUp)
        expect(mockedUtils.arrayMove).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeCardContentOrder).toHaveBeenCalledTimes(1)
    })

    test('return commentBlock and click delete', async () => {
        render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: -1, z: 0}}
            />,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonMoveUp = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonMoveUp)
        expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
    })

    test('return commentBlock and click delete with another contentOrder', async () => {
        card.fields.contentOrder = [[textBlock.id], [dividerBlock.id], [commentBlock.id]]
        render(() => wrap(() =>
            <ContentBlock
                block={commentBlock}
                card={card}
                readonly={false}
                onDrop={vi.fn()}
                width={undefined}
                cords={{x: 1, y: 0, z: 0}}
            />,
        ))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        const buttonMoveUp = screen.getByRole('button', {name: 'Delete'})
        userEvent.click(buttonMoveUp)
        expect(mockedMutator.performAsUndoGroup).toHaveBeenCalledTimes(1)
    })
})
