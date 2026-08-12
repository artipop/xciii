import {render} from '@solidjs/testing-library'

import {mockAppStore, wrapIntl} from '../../../testUtils'
import {AppStoreProvider} from '../../../store'

import ShareBoardTourStep from './shareBoard'

describe('components/onboardingTour/addComments/ShareBoardTourStep', () => {
    const state = {
        users: {
            me: {
                id: 'user_id_1',
            },
            myConfig: {
                onboardingTourStarted: {value: true},
                tourCategory: {value: 'board'},
                onboardingTourStep: {value: '2'},
            },
        },
        boards: {
            boards: {
                board_id_1: {title: 'Welcome to Boards!'},
            },
            current: 'board_id_1',
        },
        cards: {
            cards: {
                card_id_1: {title: 'Create a new card'},
            },
            current: 'card_id_1',
        },
        clientConfig: {
            value: {},
        },
    }
    let store = mockAppStore(state)

    beforeEach(() => {
        store = mockAppStore(state)
    })

    test('before hover', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ShareBoardTourStep/>
            </AppStoreProvider>,
        )
        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })

    test('after hover', () => {
        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <ShareBoardTourStep/>
            </AppStoreProvider>,
        )
        render(component)
        const elements = document.querySelectorAll('.ShareBoardTourStep')
        expect(elements.length).toBe(2)
        expect(elements[1]).toMatchSnapshot()
    })
})
