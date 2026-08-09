// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {agentBindings} from '../../components/acp/agentProjectsDialog'

// The board as a phone reads it.
//
// Every call here is a binding rather than the board's own REST API, which is
// what keeps this page working through the tailnet door exactly as it does in
// the window: the front door serves main.App.* to a phone, and the store, the
// websocket and the whole board client are not carried onto a screen that
// shows a list and moves one card.

export type MobileBoard = {
    id: string
    title: string
    icon?: string

    // What this board calls the property its columns live in, and the columns
    // themselves in the board's own order, each with the colour the board gave
    // it. They come with the board because the two questions are always asked
    // together — which board, then which column of it.
    property?: string
    columns?: MobileColumn[]
}

// A column as the board keeps it: the name a person reads and the colour it is
// drawn in, so a phone can draw it the way the board does.
export type MobileColumn = {
    value: string
    color?: string
}

export type MobileCard = {
    id: string
    boardId: string
    title: string
    icon?: string
    column?: string

    // Who made the card — for what arrived, the source that brought it.
    author?: string
    properties?: {[name: string]: string}
    updateAt?: number
}

async function readList<T>(call?: () => Promise<string>): Promise<T[]> {
    if (!call) {
        return []
    }
    try {
        return JSON.parse(await call()) || []
    } catch {
        // A phone that cannot reach the board shows an empty list rather than
        // an error: it is a screen you glance at, and there is nothing here a
        // person could do about the failure anyway.
        return []
    }
}

export function listBoards(): Promise<MobileBoard[]> {
    const bindings = agentBindings()
    return readList<MobileBoard>(bindings?.ListBoards && (() => bindings.ListBoards!()))
}

export function listInbox(): Promise<MobileCard[]> {
    const bindings = agentBindings()
    return readList<MobileCard>(bindings?.ListInbox && (() => bindings.ListInbox!()))
}

export function listBoardCards(boardId: string): Promise<MobileCard[]> {
    const bindings = agentBindings()
    if (!boardId) {
        return Promise.resolve([])
    }
    return readList<MobileCard>(bindings?.ListBoardCards && (() => bindings.ListBoardCards!(boardId)))
}

// moveCardToBoard is the phone's half of the card menu's «Переместить на
// доску…», and it is the same move: the card keeps its id, so its comments
// come with it and the source that made it still points at it.
export async function moveCardToBoard(cardId: string, boardId: string, column: string): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.MoveCardToBoard) {
        throw new Error('перенос недоступен')
    }
    await bindings.MoveCardToBoard(cardId, boardId, column)
}

export function isBoardReadable(): boolean {
    return Boolean(agentBindings()?.ListBoards)
}
