// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, waitFor} from '@solidjs/testing-library'

import {TestBlockFactory} from '../../test/testBlockFactory'
import '@testing-library/jest-dom'
import {mockAppStore, wrapIntl} from '../../testUtils'
import {IntlProvider} from '../../intl'
import {AppStoreProvider} from '../../store'
import {IPropertyTemplate} from '../../blocks/board'

import mutator from '../../mutator'

import CalendarView from './fullCalendar'

vi.mock('../../mutator')

describe('components/calendar/toolbar', () => {
    const mockShow = vi.fn()
    const mockAdd = vi.fn()
    const dateDisplayProperty = {
        id: '12345',
        name: 'DateProperty',
        type: 'date',
        options: [],
    } as IPropertyTemplate
    const board = TestBlockFactory.createBoard()
    const view = TestBlockFactory.createBoardView(board)
    view.fields.viewType = 'calendar'
    view.fields.groupById = undefined
    const card = TestBlockFactory.createCard(board)
    const fifth = Date.UTC(2021, 9, 5, 12)
    const twentieth = Date.UTC(2021, 9, 20, 12)
    card.createAt = fifth
    const rObject = {from: twentieth}

    const state = {
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
    }
    const store = mockAppStore(state)
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('return calendar, no date property', () => {
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('return calendar, with date property not set', () => {
        board.cardProperties.push(dateDisplayProperty)
        card.fields.properties['12345'] = JSON.stringify(rObject)
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('return calendar, with date property set', () => {
        board.cardProperties.push(dateDisplayProperty)
        card.fields.properties['12345'] = JSON.stringify(rObject)
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        readonly={false}
                        dateDisplayProperty={dateDisplayProperty}
                        cards={[card]}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    test('return calendar, without permissions', () => {
        const localStore = mockAppStore({...state, teams: {current: undefined}})
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={localStore}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )
        expect(container).toMatchSnapshot()
    })

    // Week or month is the view's own answer, so it comes back with the view
    // — on the next screen, and after the app has been closed. It lived
    // nowhere at all before this: every mount opened on the month.
    test('opens on the span the view remembers', () => {
        const weekly = TestBlockFactory.createBoardView(board)
        weekly.fields.viewType = 'calendar'
        weekly.fields.calendarSpan = 'dayGridWeek'

        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={weekly}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )

        expect(container.querySelector('.fc-dayGridWeek-view')).not.toBeNull()
        expect(container.querySelector('.fc-dayGridMonth-view')).toBeNull()
    })

    // Choosing one writes it to the view, which is what makes it survive
    // anything. Every prev/next reports the span too, and writing on those
    // would put the board in the way of somebody just looking around.
    test('records the span when it changes, and only then', async () => {
        const mockedMutator = vi.mocked(mutator)
        const {container} = render(() =>
            wrapIntl(() =>
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>,
            ),
        )

        // Mounting on the month it already shows writes nothing.
        expect(mockedMutator.changeViewCalendarSpan).not.toHaveBeenCalled()
        mockedMutator.changeViewCalendarSpan.mockResolvedValue()

        const week = container.querySelector('.fc-dayGridWeek-button') as HTMLButtonElement
        week.click()

        await waitFor(() => expect(mockedMutator.changeViewCalendarSpan).
            toHaveBeenCalledWith(board.id, view.id, 'dayGridWeek'))
    })

    // The month in the title, the weekday headings and «ещё N» are FullCalendar's
    // own words, not message ids, and it ships knowing English alone — which is
    // how a Russian board came to be headed "October 2021".
    test('names the month in the language the app is set to', async () => {
        const {container} = render(() => (
            <IntlProvider
                locale='ru'
                messages={{}}
            >
                <AppStoreProvider store={store}>
                    <CalendarView
                        board={board}
                        activeView={view}
                        cards={[card]}
                        readonly={false}
                        showCard={mockShow}
                        addCard={mockAdd}
                        initialDate={new Date(fifth)}
                    />
                </AppStoreProvider>
            </IntlProvider>
        ))

        await waitFor(() => expect(container.querySelector('.fc-toolbar-title')).toHaveTextContent('октябрь 2021'))
        expect(container.querySelector('.fc-col-header-cell')).toHaveTextContent('пн')
    })
})
