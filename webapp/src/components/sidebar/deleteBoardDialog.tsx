// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../intl'

import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'

import Dialog from '../dialog'
import RootPortal from '../rootPortal'

import './deleteBoardDialog.scss'

type Props = {
    boardTitle: string
    onClose: () => void
    onDelete: () => Promise<void>
    isTemplate?: boolean
}

export default function DeleteBoardDialog(props: Props): JSX.Element {
    const [isSubmitting, setSubmitting] = createSignal(false)

    return (
        <RootPortal>
            <Dialog
                onClose={props.onClose}
                toolsMenu={null}
                className='DeleteBoardDialog'
            >
                <div class='container'>
                    <h2 class='header text-heading5'>
                        <Show
                            when={props.isTemplate}
                            fallback={
                                <FormattedMessage
                                    id='DeleteBoardDialog.confirm-tite'
                                    defaultMessage='Confirm delete board'
                                />
                            }
                        >
                            <FormattedMessage
                                id='DeleteBoardDialog.confirm-tite-template'
                                defaultMessage='Confirm delete board template'
                            />
                        </Show>
                    </h2>
                    <p class='body'>
                        <Show
                            when={props.isTemplate}
                            fallback={
                                <FormattedMessage
                                    id='DeleteBoardDialog.confirm-info'
                                    defaultMessage='Are you sure you want to delete the board “{boardTitle}”? Deleting it will delete all cards in the board.'
                                    values={{
                                        boardTitle: props.boardTitle,
                                    }}
                                />
                            }
                        >
                            <FormattedMessage
                                id='DeleteBoardDialog.confirm-info-template'
                                defaultMessage='Are you sure you want to delete the board template “{boardTitle}”?'
                                values={{
                                    boardTitle: props.boardTitle,
                                }}
                            />
                        </Show>
                    </p>
                    <div class='footer'>
                        <Button
                            size={'medium'}
                            emphasis={'tertiary'}
                            onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                !isSubmitting() && props.onClose()
                            }}
                        >
                            <FormattedMessage
                                id='DeleteBoardDialog.confirm-cancel'
                                defaultMessage='Cancel'
                            />
                        </Button>
                        <Button
                            size={'medium'}
                            filled={true}
                            danger={true}
                            onClick={async (e: MouseEvent) => {
                                e.stopPropagation()
                                try {
                                    setSubmitting(true)
                                    await props.onDelete()
                                    setSubmitting(false)
                                    props.onClose()
                                } catch (err) {
                                    setSubmitting(false)
                                    Utils.logError(`Delete board ERROR: ${err}`)

                                    // TODO: display error on screen
                                }
                            }}
                        >
                            <FormattedMessage
                                id='DeleteBoardDialog.confirm-delete'
                                defaultMessage='Delete'
                            />
                        </Button>
                    </div>
                </div>
            </Dialog>
        </RootPortal>
    )
}
