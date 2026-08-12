import {Show, createSignal} from 'solid-js'
import {render} from '@solidjs/testing-library'

import {Card, createCard} from '../blocks/card'
import {Board, IPropertyTemplate} from '../blocks/board'
import mutator from '../mutator'
import {mockAppStore, wrapIntl} from '../testUtils'
import {AppStoreProvider} from '../store'

import TextProperty from './text/property'
import BaseTextEditor from './baseTextEditor'

// Closing a card disposes the whole dialog in the same tick the store stops
// knowing about the card, so anything reading the card from onCleanup reads
// nothing. This one flushed an unsaved value on unmount and threw doing it —
// and a throw inside disposal aborts the disposal, which left the card dialog
// on screen with no way to close it: not the ×, not Escape, not the backdrop.
describe('properties/baseTextEditor', () => {
    it('survives being disposed after its card is gone', () => {
        const store = mockAppStore({})
        const [card, setCard] = createSignal<Card | undefined>(createCard())

        const component = () => wrapIntl(() => (
            <AppStoreProvider store={store}>
                <Show when={card()}>
                    <BaseTextEditor
                        property={new TextProperty()}
                        board={{id: 'board-id'} as Board}
                        card={card()!}
                        readOnly={false}
                        propertyValue=''
                        propertyTemplate={{id: 'property-id'} as IPropertyTemplate}
                        showEmptyPlaceholder={false}
                        validator={() => true}
                    />
                </Show>
            </AppStoreProvider>
        ))

        render(component)

        // The card goes first, the editor is disposed second — the order the
        // card dialog actually unmounts in.
        expect(() => setCard(undefined)).not.toThrow()
    })

    // The dialog is reused when you switch cards: both are truthy, so nothing
    // unmounts and this editor keeps the value it read from the first one.
    // Flushing that on disposal wrote one card's estimate onto another — which
    // is how a card on my own board ended up renamed while I was testing.
    it('does not flush its value onto a card the value did not come from', () => {
        const first = createCard()
        first.fields.properties = {'property-id': '8'}
        const second = createCard()
        second.fields.properties = {'property-id': '32'}

        const store = mockAppStore({})
        const [card, setCard] = createSignal<Card | undefined>(first)
        const changed = vi.spyOn(mutator, 'changePropertyValue').mockResolvedValue(undefined as never)

        const component = () => wrapIntl(() => (
            <AppStoreProvider store={store}>
                <Show when={card()}>
                    <BaseTextEditor
                        property={new TextProperty()}
                        board={{id: 'board-id'} as Board}
                        card={card()!}
                        readOnly={false}
                        propertyValue=''
                        propertyTemplate={{id: 'property-id'} as IPropertyTemplate}
                        showEmptyPlaceholder={false}
                        validator={() => true}
                    />
                </Show>
            </AppStoreProvider>
        ))

        const {unmount} = render(component)

        // The card is swapped under a dialog that is still open — which is what
        // happens when you click another card without closing this one — and
        // only then is the editor disposed. Setting the card to undefined
        // instead would prove nothing: the "card is gone" guard would catch it.
        setCard(second)
        unmount()

        expect(changed).not.toHaveBeenCalled()
    })
})
