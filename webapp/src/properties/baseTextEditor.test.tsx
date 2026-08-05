// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show, createSignal} from 'solid-js'
import {render} from '@solidjs/testing-library'

import {Card, createCard} from '../blocks/card'
import {Board, IPropertyTemplate} from '../blocks/board'
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
})
