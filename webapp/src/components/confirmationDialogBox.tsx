// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Component, JSX} from 'solid-js'

import {FormattedMessage} from '../intl'

import Button from '../widgets/buttons/button'

import Dialog from './dialog'
import './confirmationDialogBox.scss'

type ConfirmationDialogBoxProps = {
    heading: string
    subText?: string | JSX.Element
    confirmButtonText?: string
    destructive?: boolean
    onConfirm: () => void
    onClose: () => void
}

type Props = {
    dialogBox: ConfirmationDialogBoxProps
}

export const ConfirmationDialogBox: Component<Props> = (props) => {
    return (
        <Dialog
            size='small'
            className='confirmation-dialog-box'
            onClose={props.dialogBox.onClose}
        >
            <div
                class='box-area'
                title='Confirmation Dialog Box'
            >
                <h3 class='text-heading5'>{props.dialogBox.heading}</h3>
                <div class='sub-text'>{props.dialogBox.subText}</div>

                <div class='action-buttons'>
                    <Button
                        title='Cancel'
                        size='medium'
                        emphasis='tertiary'
                        onClick={props.dialogBox.onClose}
                    >
                        <FormattedMessage
                            id='ConfirmationDialog.cancel-action'
                            defaultMessage='Cancel'
                        />
                    </Button>
                    <Button
                        title={props.dialogBox.confirmButtonText || 'Confirm'}
                        size='medium'
                        submit={true}
                        danger={Boolean(props.dialogBox.destructive)}
                        onClick={props.dialogBox.onConfirm}
                        filled={true}
                    >
                        { props.dialogBox.confirmButtonText ||
                        <FormattedMessage
                            id='ConfirmationDialog.confirm-action'
                            defaultMessage='Confirm'
                        />
                        }
                    </Button>
                </div>
            </div>
        </Dialog>
    )
}

export default ConfirmationDialogBox
export {type ConfirmationDialogBoxProps}
