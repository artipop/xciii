import {render, screen} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import {TestBlockFactory} from '../test/testBlockFactory'
import {blocksById, mockAppStore, wrapDNDIntl} from '../testUtils'
import {AppStoreProvider, RootState} from '../store'

import {CommentBlock} from '../blocks/commentBlock'

import {CheckboxBlock} from '../blocks/checkboxBlock'

import {ShowUsername} from '../utils'

import CardBadges from './cardBadges'

const defaultConfig = {enablePublicSharedBoards: false, teammateNameDisplay: ShowUsername, featureFlags: {}, maxFileSize: 0, teamMode: false}

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
            cards: blocksById([card, emptyCard]),
            templates: {},
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
    })

    // A count is an invitation to open something, and on an install of one
    // person there is nothing to open: the panel that draws comments is off
    // (docs/teamwork.md). The comments are in the store either way — agents
    // write them in both modes.
    it('says nothing about comments while one person works the board', () => {
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <CardBadges card={card}/>
            </AppStoreProvider>,
        ))
        expect(screen.queryByTitle('Comments')).toBeNull()
    })

    it('counts the comments once there is somebody to have said them', () => {
        const team = mockAppStore({...state, clientConfig: {value: {...defaultConfig, teamMode: true}}})
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={team}>
                <CardBadges card={card}/>
            </AppStoreProvider>,
        ))
        expect(screen.getByTitle('Comments')).toHaveTextContent('3')
    })
})
