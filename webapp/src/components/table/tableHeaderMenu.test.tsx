// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, render} from '@solidjs/testing-library'

import '@testing-library/jest-dom'
import {wrapIntl} from '../../testUtils'

import 'isomorphic-fetch'

import {Constants} from '../../constants'
import mutator from '../../mutator'

import {TestBlockFactory} from '../../test/testBlockFactory'
import {FetchMock} from '../../test/fetchMock'

import TableHeaderMenu from './tableHeaderMenu'

global.fetch = FetchMock.fn

// import mutator from '../../mutator'

// The mutator is a default export, and a factory has to say so: babel's CJS
// interop used to hand the whole object back as the default, ESM does not.
vi.mock('../../mutator', () => ({
    default: {
        changeViewSortOptions: vi.fn(),
        insertPropertyTemplate: vi.fn(),
        changeViewVisibleProperties: vi.fn(),
        duplicatePropertyTemplate: vi.fn(),
        deleteProperty: vi.fn(),
    },
}))

beforeEach(() => {
    vi.resetAllMocks()
    FetchMock.fn.mockReset()
})

describe('components/table/TableHeaderMenu', () => {
    const board = TestBlockFactory.createBoard()
    const view = TestBlockFactory.createBoardView(board)

    const view2 = TestBlockFactory.createBoardView(board)
    view2.fields.sortOptions = []

    test('should match snapshot, title column', async () => {
        const component = () => wrapIntl(() =>
            <TableHeaderMenu
                templateId={Constants.titleColumnId}
                board={board}
                activeView={view}
                views={[view, view2]}
                cards={[]}
            />,
        )
        const {container, getByText} = render(component)

        let sort = getByText(/Sort ascending/i)
        fireEvent.click(sort)
        sort = getByText(/Sort descending/i)
        fireEvent.click(sort)
        expect(mutator.changeViewSortOptions).toHaveBeenCalledTimes(2)

        let insert = getByText(/Insert left/i)
        fireEvent.click(insert)
        insert = getByText(/Insert right/i)
        fireEvent.click(insert)
        expect(mutator.insertPropertyTemplate).toHaveBeenCalledTimes(0)

        expect(container).toMatchSnapshot()
    })

    test('should match snapshot, other column', async () => {
        const component = () => wrapIntl(() =>
            <TableHeaderMenu
                templateId={'property 1'}
                board={board}
                activeView={view}
                views={[view, view2]}
                cards={[]}
            />,
        )
        const {container, getByText} = render(component)

        let sort = getByText(/Sort ascending/i)
        fireEvent.click(sort)
        sort = getByText(/Sort descending/i)
        fireEvent.click(sort)
        expect(mutator.changeViewSortOptions).toHaveBeenCalledTimes(2)

        let insert = getByText(/Insert left/i)
        fireEvent.click(insert)
        insert = getByText(/Insert right/i)
        fireEvent.click(insert)
        expect(mutator.insertPropertyTemplate).toHaveBeenCalledTimes(2)

        const hide = getByText(/Hide/i)
        fireEvent.click(hide)
        expect(mutator.changeViewVisibleProperties).toHaveBeenCalled()
        const duplicate = getByText(/Duplicate/i)
        fireEvent.click(duplicate)
        expect(mutator.duplicatePropertyTemplate).toHaveBeenCalled()
        const del = getByText(/Delete/i)
        fireEvent.click(del)
        expect(mutator.deleteProperty).toHaveBeenCalled()

        expect(container).toMatchSnapshot()
    })
})
