// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'
import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import CardDetailContentsMenu from './cardDetailContentsMenu'

//for contentRegistry
import '../content/textElement'
import '../content/imageElement'
import '../content/dividerElement'
import '../content/checkboxElement'
import {CardDetailProvider} from './cardDetailContext'

vi.mock('../../mutator')

const board = TestBlockFactory.createBoard()
const card = TestBlockFactory.createCard(board)
describe('components/cardDetail/cardDetailContentsMenu', () => {
    const store = mockAppStore({})
    const wrap = (child: () => JSX.Element): JSX.Element => (
        wrapIntl(() =>
            <AppStoreProvider store={store}>
                <CardDetailProvider card={card}>
                    {child()}
                </CardDetailProvider>
            </AppStoreProvider>,
        )
    )
    beforeEach(() => {
        vi.clearAllMocks()
    })
    test('return cardDetailContentsMenu', () => {
        const {container} = render(() => wrap(() => <CardDetailContentsMenu/>))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
    })

    test('return cardDetailContentsMenu and add Text content', async () => {
        const {container} = render(() => wrap(() => <CardDetailContentsMenu/>))
        const buttonElement = screen.getByRole('button', {name: 'menuwrapper'})
        userEvent.click(buttonElement)
        expect(container).toMatchSnapshot()
        const buttonAddText = screen.getByRole('button', {name: 'text'})
        userEvent.click(buttonAddText)
        expect(container).toMatchSnapshot()
    })
})
