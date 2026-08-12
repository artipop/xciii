import {render, screen} from '@solidjs/testing-library'

import userEvent from '@testing-library/user-event'

import '@testing-library/jest-dom'

import mutator from '../mutator'

import {wrapIntl} from '../testUtils'

import {TestBlockFactory} from '../test/testBlockFactory'

import BlockIconSelector from './blockIconSelector'

const card = TestBlockFactory.createCard()
const icon = '👍'

vi.mock('../mutator')

// emoji-mart 5 renders inside a shadow root, which Testing Library cannot query.
// The unit under test is what blockIconSelector does with a chosen emoji, not how
// the picker draws itself, so the picker is reduced to a button that reports one.
vi.mock('../widgets/emojiPicker', () => ({
    __esModule: true,
    default: (props: {onSelect: (emoji: string) => void}) => (
        <button
            aria-label='thumbsup'
            onClick={() => props.onSelect('\u{1F44D}')}
        />
    ),
}))
const mockedMutator = vi.mocked(mutator)

describe('components/blockIconSelector', () => {
    beforeEach(() => {
        card.fields.icon = icon
        vi.clearAllMocks()
    })
    test('return an icon correctly', () => {
        const {container} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        expect(container).toMatchSnapshot()
    })
    test('return no element with no icon', () => {
        card.fields.icon = ''
        const {container} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        expect(container).toMatchSnapshot()
    })
    test('return menu on click', () => {
        const {container} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        userEvent.click(screen.getByRole('button', {name: 'menuwrapper'}))
        expect(container).toMatchSnapshot()
    })
    test('return no menu in readonly', () => {
        const {container} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                readonly={true}
            />,
        ))
        expect(container).toMatchSnapshot()
    })

    test('return a new icon after click on random menu', () => {
        render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        userEvent.click(screen.getByRole('button', {name: 'menuwrapper'}))
        const buttonRandom = screen.queryByRole('button', {name: 'Random'})
        expect(buttonRandom).not.toBeNull()
        userEvent.click(buttonRandom!)
        expect(mockedMutator.changeBlockIcon).toHaveBeenCalledTimes(1)
    })

    test('return a new icon after click on EmojiPicker', () => {
        const {container, getByRole, getAllByRole} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        userEvent.click(getByRole('button', {name: 'menuwrapper'}))
        const menuPicker = container.querySelector('div#pick')
        expect(menuPicker).not.toBeNull()

        userEvent.click(menuPicker!)

        const allButtonThumbUp = getAllByRole('button', {name: /thumbsup/i})
        userEvent.click(allButtonThumbUp[0])
        expect(mockedMutator.changeBlockIcon).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeBlockIcon).toHaveBeenCalledWith(card.boardId, card.id, card.fields.icon, '👍')
    })

    test('return no icon after click on remove menu', () => {
        const first = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
                size='l'
            />,
        ))
        userEvent.click(screen.getByRole('button', {name: 'menuwrapper'}))
        const buttonRemove = screen.queryByRole('button', {name: 'Remove icon'})
        expect(buttonRemove).not.toBeNull()
        userEvent.click(buttonRemove!)
        expect(mockedMutator.changeBlockIcon).toHaveBeenCalledTimes(1)
        expect(mockedMutator.changeBlockIcon).toHaveBeenCalledWith(card.boardId, card.id, card.fields.icon, '', 'remove icon')

        //simulate reset icon: a fresh render stands in for the rerender
        //@solidjs/testing-library does not have
        card.fields.icon = ''
        first.unmount()

        const {container} = render(() => wrapIntl(() =>
            <BlockIconSelector
                block={card}
            />),
        )
        expect(container).toMatchSnapshot()
    })
})
