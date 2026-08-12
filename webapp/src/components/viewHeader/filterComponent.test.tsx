import {render, screen} from '@solidjs/testing-library'

import '@testing-library/jest-dom'

import userEvent from '@testing-library/user-event'

import {FilterClause} from '../../blocks/filterClause'

import {TestBlockFactory} from '../../test/testBlockFactory'
import mutator from '../../mutator'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import FilterComponenet from './filterComponent'

vi.mock('../../mutator')
const mockedMutator = vi.mocked(mutator)

const board = TestBlockFactory.createBoard()
const activeView = TestBlockFactory.createBoardView(board)

const filter: FilterClause = {
    propertyId: board.cardProperties[0].id,
    condition: 'includes',
    values: ['Status'],
}
const unknownFilter: FilterClause = {
    propertyId: 'unknown',
    condition: 'includes',
    values: [],
}

const state = {
    users: {
        me: {
            id: 'user-id-1',
            username: 'username_1',
        },
    },
}
const store = mockAppStore(state)
describe('components/viewHeader/filterComponent', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        board.cardProperties[0].options = [{id: 'Status', value: 'Status', color: ''}]
        activeView.fields.filter.filters = [filter]
    })
    test('return filterComponent', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <FilterComponenet
                        board={board}
                        activeView={activeView}
                        onClose={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })
    test('return filterComponent and add Filter', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <FilterComponenet
                        board={board}
                        activeView={activeView}
                        onClose={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonAdd = screen.getByText('+ Add filter')
        userEvent.click(buttonAdd)
        expect(mockedMutator.changeViewFilter).toHaveBeenCalledTimes(1)
    })

    test('return filterComponent and filter by status', () => {
        activeView.fields.filter.filters = [unknownFilter]
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <FilterComponenet
                        board={board}
                        activeView={activeView}
                        onClose={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getAllByRole('button', {name: 'menuwrapper'})[0]
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonStatus = screen.getByRole('button', {name: 'Status'})
        userEvent.click(buttonStatus)
        expect(mockedMutator.changeViewFilter).toHaveBeenCalledTimes(1)
    })

    test('return filterComponent and click is empty', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <FilterComponenet
                        board={board}
                        activeView={activeView}
                        onClose={vi.fn()}
                    />
                </AppStoreProvider>,
            ),
        )
        const buttonElement = screen.getAllByRole('button', {name: 'menuwrapper'})[1]
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonNotInclude = screen.getByRole('button', {name: 'is empty'})
        userEvent.click(buttonNotInclude)
        expect(mockedMutator.changeViewFilter).toHaveBeenCalledTimes(1)
    })
})
