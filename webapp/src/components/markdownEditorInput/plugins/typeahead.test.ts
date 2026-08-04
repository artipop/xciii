// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {basicTypeaheadTriggerMatch} from './typeahead'

describe('components/markdownEditorInput/plugins/typeahead', () => {
    // The trigger is the contract both menus hang on: '@' with minLength 0
    // opens mentions on the bare trigger, ':' with minLength 1 waits for a
    // character so a plain colon in prose does not open the emoji menu.
    test('matches a trigger at the start, after whitespace, and not mid-word', () => {
        const match = basicTypeaheadTriggerMatch('@', {minLength: 0})

        expect(match('@ab')).toEqual({leadOffset: 0, matchingString: 'ab', replaceableString: '@ab'})
        expect(match('hello @ab')?.matchingString).toBe('ab')
        expect(match('hello @ab')?.leadOffset).toBe(6)
        expect(match('mail@example')).toBeNull()
    })

    test('the bare trigger opens a menu only when minLength allows it', () => {
        expect(basicTypeaheadTriggerMatch('@', {minLength: 0})('@')).toEqual({leadOffset: 0, matchingString: '', replaceableString: '@'})
        expect(basicTypeaheadTriggerMatch(':', {minLength: 1})(':')).toBeNull()
        expect(basicTypeaheadTriggerMatch(':', {minLength: 1})(':sm')?.matchingString).toBe('sm')
    })

    test('a finished query ends at whitespace and punctuation', () => {
        const match = basicTypeaheadTriggerMatch('@', {minLength: 0})

        expect(match('@user ')).toBeNull()
        expect(match('@user.')).toBeNull()
    })
})
