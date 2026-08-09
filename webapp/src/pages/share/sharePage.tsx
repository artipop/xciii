// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createEffect, createSignal, onMount} from 'solid-js'
import type {Component} from 'solid-js'
import {useSearchParams} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../../intl'
import {BindingBoard, listBoards} from '../../bindings/boards'

import {closeShare, shareItem} from './shareBindings'
import './sharePage.scss'

// The dialog the system's «Поделиться» opens.
//
// Everything it is given arrives in the URL — the share extension has no way to
// hand over anything else, and a page that reads its input from the address is
// a page a phone, a browser and the app's own little window can all open. What
// it asks is one question: which board. The title and the note are there
// because a link is easier to find again when it says what it was for, and both
// have sensible answers already filled in.

// lastBoardKey remembers the board picked last time. Most links a person sends
// themselves go to the same place, and the dialog exists to be dismissed in two
// seconds — one of which would otherwise go on finding the same board again.
const lastBoardKey = 'xciii.share.board'

function rememberBoard(id: string): void {
    try {
        localStorage.setItem(lastBoardKey, id)
    } catch {
        // Private browsing, or a webview with storage turned off. The dialog
        // works without a memory; it just asks again.
    }
}

function recalledBoard(): string {
    try {
        return localStorage.getItem(lastBoardKey) || ''
    } catch {
        return ''
    }
}

const SharePage: Component = () => {
    const intl = useIntl()
    const [params] = useSearchParams()

    const [boards, setBoards] = createSignal<BindingBoard[]>([])
    const [ready, setReady] = createSignal(false)
    const [target, setTarget] = createSignal('')
    const [title, setTitle] = createSignal('')
    const [note, setNote] = createSignal('')
    const [busy, setBusy] = createSignal(false)
    const [error, setError] = createSignal('')
    const [done, setDone] = createSignal<'created' | 'already' | ''>('')

    const url = () => String(params.url || '')

    // The title is what the sharing app called the page, and the note starts
    // with anything it sent as text — a selection, usually, which is exactly
    // what somebody sharing a quote wants to keep.
    onMount(() => {
        setTitle(String(params.title || ''))
        setNote(String(params.text || ''))
    })

    onMount(async () => {
        const list = await listBoards()
        setBoards(list)
        setReady(true)
    })

    // Preselected once the boards are known: the one used last time if it is
    // still there, otherwise the first. A dialog that opens with nothing
    // selected asks two questions instead of one.
    createEffect(() => {
        if (target() || boards().length === 0) {
            return
        }
        const remembered = boards().find((board) => board.id === recalledBoard())
        setTarget(remembered?.id || boards()[0].id)
    })

    const send = async () => {
        const boardId = target()
        if (!boardId || busy()) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const result = await shareItem(boardId, title(), url(), note())
            rememberBoard(boardId)
            if (result.failed) {
                // The pipeline counts a refusal rather than throwing it, so a
                // batch of one that failed would otherwise look like success.
                setError(intl.formatMessage({id: 'Share.failed', defaultMessage: 'Could not file it. Try again.'}))
                return
            }
            setDone(result.created ? 'created' : 'already')

            // Left on screen for a moment: the window closing is the only
            // acknowledgement there is, and one that happens instantly reads as
            // the button not having worked.
            setTimeout(() => {
                closeShare()
            }, 900)
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div class='SharePage'>
            <Show
                when={!done()}
                fallback={
                    <div class='SharePage__done'>
                        <Show
                            when={done() === 'created'}
                            fallback={
                                <FormattedMessage
                                    id='Share.already'
                                    defaultMessage='It is already in the inbox.'
                                />
                            }
                        >
                            <FormattedMessage
                                id='Share.created'
                                defaultMessage='Filed in the inbox.'
                            />
                        </Show>
                    </div>
                }
            >
                <h1 class='SharePage__heading'>
                    <FormattedMessage
                        id='Share.title'
                        defaultMessage='Save to a board'
                    />
                </h1>

                <input
                    class='SharePage__title'
                    type='text'
                    value={title()}
                    placeholder={intl.formatMessage({id: 'Share.untitled', defaultMessage: 'Title'})}
                    onInput={(e) => setTitle(e.currentTarget.value)}
                />
                <Show when={url()}>
                    <p class='SharePage__url'>{url()}</p>
                </Show>
                <textarea
                    class='SharePage__note'
                    rows='2'
                    value={note()}
                    placeholder={intl.formatMessage({id: 'Share.note', defaultMessage: 'A note, if you want one'})}
                    onInput={(e) => setNote(e.currentTarget.value)}
                />

                <h2 class='SharePage__label'>
                    <FormattedMessage
                        id='Share.board'
                        defaultMessage='Which board?'
                    />
                </h2>
                <Show
                    when={boards().length > 0}
                    fallback={
                        <Show when={ready()}>
                            <p class='SharePage__empty'>
                                <FormattedMessage
                                    id='Share.no-boards'
                                    defaultMessage='There are no boards yet.'
                                />
                            </p>
                        </Show>
                    }
                >
                    <div class='SharePage__boards'>
                        <For each={boards()}>
                            {(board) => (
                                <button
                                    type='button'
                                    class='SharePage__board'
                                    classList={{'SharePage__board--picked': target() === board.id}}
                                    aria-pressed={target() === board.id}
                                    onClick={() => setTarget(board.id)}
                                >
                                    <span class='SharePage__icon'>{board.icon}</span>
                                    {board.title}
                                </button>
                            )}
                        </For>
                    </div>
                </Show>

                <Show when={error()}>
                    <p class='SharePage__error'>{error()}</p>
                </Show>

                <div class='SharePage__actions'>
                    <button
                        type='button'
                        class='SharePage__cancel'
                        onClick={() => {
                            closeShare()
                        }}
                    >
                        <FormattedMessage
                            id='Share.cancel'
                            defaultMessage='Cancel'
                        />
                    </button>
                    <button
                        type='button'
                        class='SharePage__send'
                        disabled={busy() || !target()}
                        onClick={() => {
                            send()
                        }}
                    >
                        <FormattedMessage
                            id='Share.send'
                            defaultMessage='Save'
                        />
                    </button>
                </div>
            </Show>
        </div>
    )
}

export default SharePage
