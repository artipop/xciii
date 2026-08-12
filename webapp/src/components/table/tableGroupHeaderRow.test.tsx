import type {JSX} from 'solid-js'

import {fireEvent, render} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import 'isomorphic-fetch'

import userEvent from '@testing-library/user-event'

import {wrapDNDIntl} from '../../testUtils'

import {TestBlockFactory} from '../../test/testBlockFactory'

import {ColumnResizeProvider} from './tableColumnResizeContext'
import TableGroupHeaderRowElement from './tableGroupHeaderRow'

const board = TestBlockFactory.createBoard()
const view = TestBlockFactory.createBoardView(board)

const view2 = TestBlockFactory.createBoardView(board)
view2.fields.sortOptions = []

const boardTreeNoGroup = {
    option: {
        id: '',
        value: '',
        color: 'propColorBrown',
    },
    cards: [],
}

const boardTreeGroup = {
    option: {
        id: 'value1',
        value: 'value 1',
        color: 'propColorBrown',
    },
    cards: [],
}

const Wrapper = (props: {children?: JSX.Element}) => {
    return wrapDNDIntl(() =>
        <ColumnResizeProvider
            columnWidths={{}}
            onResizeColumn={vi.fn()}
        >
            {props.children}
        </ColumnResizeProvider>,
    )
}

test('should match snapshot, no groups', async () => {
    const {container} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={view}
                group={boardTreeNoGroup}
                readonly={false}
                hideGroup={vi.fn()}
                addCard={vi.fn()}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
                groupByProperty={{
                    id: '',
                    name: 'Property 1',
                    type: 'text',
                    options: [{id: 'property1', value: 'Property 1', color: ''}],
                }}
            />
        </Wrapper>,
    )
    expect(container).toMatchSnapshot()
})

test('should match snapshot with Group', async () => {
    const {container} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={view}
                group={boardTreeGroup}
                readonly={false}
                hideGroup={vi.fn()}
                addCard={vi.fn()}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
            />
        </Wrapper>,
    )
    expect(container).toMatchSnapshot()
})

test('should match snapshot on read only', async () => {
    const {container} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={view}
                group={boardTreeGroup}
                readonly={true}
                hideGroup={vi.fn()}
                addCard={vi.fn()}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
            />
        </Wrapper>,
    )
    expect(container).toMatchSnapshot()
})

test('should match snapshot, hide group', async () => {
    const hideGroup = vi.fn()

    const collapsedOptionsView = TestBlockFactory.createBoardView(board)
    collapsedOptionsView.fields.collapsedOptionIds = [boardTreeGroup.option.id]

    const {container} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={collapsedOptionsView}
                group={boardTreeGroup}
                readonly={false}
                hideGroup={hideGroup}
                addCard={vi.fn()}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
            />
        </Wrapper>,
    )

    const triangle = container.querySelector('.octo-table-cell__expand')
    expect(triangle).not.toBeNull()

    fireEvent.click(triangle as Element)
    expect(hideGroup).toHaveBeenCalled()
    expect(container).toMatchSnapshot()
})

test('should match snapshot, add new', async () => {
    const addNew = vi.fn()

    const {container} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={view}
                group={boardTreeGroup}
                readonly={false}
                hideGroup={vi.fn()}
                addCard={addNew}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
            />
        </Wrapper>,
    )

    const triangle = container.querySelector('i.AddIcon')
    expect(triangle).not.toBeNull()

    fireEvent.click(triangle as Element)
    expect(addNew).toHaveBeenCalled()
    expect(container).toMatchSnapshot()
})

test('should match snapshot, edit title', async () => {
    const {container, getByTitle} = render(() =>
        <Wrapper>
            <TableGroupHeaderRowElement
                board={board}
                activeView={view}
                group={boardTreeGroup}
                readonly={false}
                hideGroup={vi.fn()}
                addCard={vi.fn()}
                propertyNameChanged={vi.fn()}
                onDrop={vi.fn()}
            />
        </Wrapper>,
    )

    const input = getByTitle(/value 1/)
    userEvent.click(input)
    userEvent.keyboard('{enter}')

    expect(container).toMatchSnapshot()
})
