import '@testing-library/jest-dom'
import {render} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {wrapDNDIntl} from '../testUtils'

import ConfirmationDialogBox from './confirmationDialogBox'

describe('/components/confirmationDialogBox', () => {
    const dialogPropsWithCnfrmBtnText = {
        heading: 'test-heading',
        subText: 'test-sub-text',
        confirmButtonText: 'test-btn-text',
        onConfirm: vi.fn(),
        onClose: vi.fn(),
    }

    const dialogProps = {
        heading: 'test-heading',
        onConfirm: vi.fn(),
        onClose: vi.fn(),
    }

    it('confirmDialog should match snapshot', async () => {
        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmationDialogBox
                    dialogBox={dialogPropsWithCnfrmBtnText}
                />,
            ),
        )
        const container = result.container
        expect(container).toMatchSnapshot()
    })

    it('confirmDialog with Confirm Button Text should match snapshot', async () => {
        const result = render(() =>
            wrapDNDIntl(() =>
                <ConfirmationDialogBox
                    dialogBox={dialogPropsWithCnfrmBtnText}
                />,
            ),
        )
        const containerWithCnfrmBtnText = result.container
        expect(containerWithCnfrmBtnText).toMatchSnapshot()
    })

    it('confirm button click, run onConfirm Function once', () => {
        const result = render(() =>
            wrapDNDIntl(() => <ConfirmationDialogBox dialogBox={dialogProps}/>),
        )

        userEvent.click(result.getByTitle('Confirm'))
        expect(dialogProps.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('confirm button (with passed prop text), run onConfirm Function once', () => {
        const resultWithConfirmBtnText = render(() =>
            wrapDNDIntl(() =>
                <ConfirmationDialogBox
                    dialogBox={dialogPropsWithCnfrmBtnText}
                />,
            ),
        )

        userEvent.click(
            resultWithConfirmBtnText.getByTitle(dialogPropsWithCnfrmBtnText.confirmButtonText),
        )

        expect(dialogPropsWithCnfrmBtnText.onConfirm).toHaveBeenCalledTimes(1)
    })

    it('cancel button click runs onClose function', () => {
        const result = render(() => wrapDNDIntl(() =>
            <ConfirmationDialogBox
                dialogBox={dialogProps}
            />,
        ))

        userEvent.click(result.getByTitle('Cancel'))
        expect(dialogProps.onClose).toHaveBeenCalledTimes(1)
    })
})
