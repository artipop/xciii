// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {render} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import {mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import 'isomorphic-fetch'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {ColumnResizeProvider} from './tableColumnResizeContext'
import TableRow from './tableRow'

describe('components/table/TableRow', () => {
    const board = TestBlockFactory.createBoard()
    const view = TestBlockFactory.createBoardView(board)

    const view2 = TestBlockFactory.createBoardView(board)
    view2.fields.sortOptions = []

    const card = TestBlockFactory.createCard(board)
    const cardTemplate = TestBlockFactory.createCard(board)
    cardTemplate.fields.isTemplate = true

    const state = {
        users: {},
        comments: {
            comments: {},
        },
        contents: {
            contents: {},
        },
        cards: {
            cards: {
                [card.id]: card,
            },
        },
    }

    const Wrapper = (props: {children?: JSX.Element}) => {
        const store = mockAppStore(state)
        return wrapDNDIntl(() =>
            <ColumnResizeProvider
                columnWidths={{}}
                onResizeColumn={vi.fn()}
            >
                <AppStoreProvider store={store}>
                    {props.children}
                </AppStoreProvider>
            </ColumnResizeProvider>,
        )
    }

    test('should match snapshot', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    visiblePropertyIds={view.fields.visiblePropertyIds}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    isLastCard={false}
                    collapsedOptionIds={view.fields.collapsedOptionIds}
                    card={card}
                    isSelected={false}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={false}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, read-only', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    card={card}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    visiblePropertyIds={view.fields.visiblePropertyIds}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    isLastCard={false}
                    collapsedOptionIds={view.fields.collapsedOptionIds}
                    isSelected={false}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={true}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, isSelected', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    card={card}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    visiblePropertyIds={view.fields.visiblePropertyIds}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    isLastCard={false}
                    collapsedOptionIds={view.fields.collapsedOptionIds}
                    isSelected={true}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={false}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, collapsed tree', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    card={card}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    visiblePropertyIds={view.fields.visiblePropertyIds}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    isLastCard={false}
                    collapsedOptionIds={['value1']}
                    isSelected={false}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={false}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, display properties', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    card={card}
                    visiblePropertyIds={['property1', 'property2']}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    collapsedOptionIds={view.fields.collapsedOptionIds}
                    isLastCard={false}
                    isSelected={false}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={false}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, resizing column', async () => {
        const {container} = render(() =>
            <Wrapper>
                <TableRow
                    board={board}
                    card={card}
                    visiblePropertyIds={['property1', 'property2']}
                    columnWidths={view.fields.columnWidths}
                    addCard={vi.fn()}
                    isManualSort={view.fields.sortOptions.length === 0}
                    groupById={view.fields.groupById}
                    isLastCard={false}
                    collapsedOptionIds={view.fields.collapsedOptionIds}
                    isSelected={false}
                    focusOnMount={false}
                    showCard={vi.fn()}
                    readonly={false}
                    onDrop={vi.fn()}
                />
            </Wrapper>,
        )
        expect(container).toMatchSnapshot()
    })
})
