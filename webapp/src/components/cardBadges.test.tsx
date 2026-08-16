import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {TestBlockFactory} from '../test/testBlockFactory'
import {blocksById, mockAppStore, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider, RootState} from '../store'

import {CommentBlock} from '../blocks/commentBlock'

import {CheckboxBlock} from '../blocks/checkboxBlock'

import CardBadges from './cardBadges'

describe('components/cardBadges', () => {
    const board = TestBlockFactory.createBoard()
    const card = TestBlockFactory.createCard(board)
    const emptyCard = TestBlockFactory.createCard(board)
    const text = TestBlockFactory.createText(card)
    text.title = `
                ## Header
                - [x] one
                - [ ] two
                - [x] three
   `.replace(/\n\s+/gm, '\n')
    const comments = Array.from(Array<CommentBlock>(3), () => TestBlockFactory.createComment(card))
    const checkboxes = Array.from(Array<CheckboxBlock>(4), () => TestBlockFactory.createCheckbox(card))
    checkboxes[2].fields.value = true

    const state: Partial<RootState> = {
        cards: {
            current: '',
            limitTimestamp: 0,
            cards: blocksById([card, emptyCard]),
            templates: {},
            cardHiddenWarning: true,
        },
        comments: {
            comments: blocksById(comments),
            commentsByCard: {
                [card.id]: comments,
            },
        },
        contents: {
            contents: {
                ...blocksById([text]),
                ...blocksById(checkboxes),
            },
            contentsByCard: {
                [card.id]: [text, ...checkboxes],
            },
        },
    }
    const store = mockAppStore(state)

    it('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardBadges card={card}/>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    it('should match snapshot for empty card', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardBadges card={emptyCard}/>
            </AppStoreProvider>,
        ))
        expect(container).toMatchSnapshot()
    })

    it('should render correct values', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardBadges card={card}/>
            </AppStoreProvider>,
        ))
        expect(screen.getByTitle(/card has a description/)).toBeInTheDocument()
        expect(screen.getByTitle('Checkboxes')).toHaveTextContent('3/7')

        // The card carries three comments in the store and says nothing about
        // them: the list they would open is commented out while this app has
        // one person in it (docs/teamwork.md).
        expect(screen.queryByTitle('Comments')).toBeNull()
    })
})
