// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Solid face of @formatjs/intl, replacing react-intl: the same IntlShape,
// message ids and ICU/AST messages, provided through Solid context. Components
// keep calling useIntl().formatMessage and rendering <FormattedMessage/> —
// only the import changes.

import {
    createIntl as formatjsCreateIntl,
    createIntlCache,
    IntlShape,
    MessageDescriptor,
} from '@formatjs/intl'
import {Accessor, Component, JSX, ParentComponent, createContext, createMemo, useContext} from 'solid-js'

export type {IntlShape, MessageDescriptor}

// react-intl rendered rich-text chunks as React nodes; here a chunk is JSX.
type MessageValues = Record<string, string | number | boolean | Date | JSX.Element | ((chunks: JSX.Element[]) => JSX.Element)> | undefined

const IntlContext = createContext<Accessor<IntlShape>>()

// createIntl stays available for the few places that format outside any
// component tree (CSV export, error boundaries).
export const createIntl = formatjsCreateIntl

type ProviderProps = {
    locale: string
    messages: Record<string, string>
}

export const IntlProvider: ParentComponent<ProviderProps> = (props) => {
    const cache = createIntlCache()
    const intl = createMemo(() => formatjsCreateIntl({
        locale: props.locale,
        defaultLocale: 'en',
        messages: props.messages,
    }, cache))
    return (
        <IntlContext.Provider value={intl}>
            {props.children}
        </IntlContext.Provider>
    )
}

// The returned object delegates every access to the current shape, so a
// formatMessage call inside a tracked scope re-runs when the locale changes —
// what remounting the provider subtree did under React.
export function useIntl(): IntlShape {
    const intl = useContext(IntlContext)
    if (!intl) {
        throw new Error('useIntl must be used inside IntlProvider')
    }
    return new Proxy({} as IntlShape, {
        get(_target, prop) {
            const value = intl()[prop as keyof IntlShape]
            if (typeof value === 'function') {
                return (value as (...args: unknown[]) => unknown).bind(intl())
            }
            return value
        },
    })
}

type FormattedMessageProps = {
    id?: MessageDescriptor['id']
    defaultMessage?: MessageDescriptor['defaultMessage']
    description?: MessageDescriptor['description']
    values?: MessageValues
}

export const FormattedMessage: Component<FormattedMessageProps> = (props) => {
    const intl = useIntl()
    return <>{intl.formatMessage(
        {id: props.id, defaultMessage: props.defaultMessage, description: props.description},
        props.values as Parameters<IntlShape['formatMessage']>[1],
    )}</>
}
