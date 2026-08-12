import {Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {sendFlashMessage} from '../flashMessages'
import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {getCurrentTeam, Team} from '../../store/teams'

import Modal from '../modal'

import './registrationLink.scss'

type Props = {
    onClose: () => void
}

const RegistrationLink = (props: Props) => {
    const intl = useIntl()

    const team = useAppSelector<Team|null>(getCurrentTeam)
    const signupToken = () => team()?.signupToken
    const {actions} = useAppStore()

    const [wasCopied, setWasCopied] = createSignal(false)

    const regenerateToken = async () => {
        // eslint-disable-next-line no-alert
        const accept = window.confirm(intl.formatMessage({id: 'RegistrationLink.confirmRegenerateToken', defaultMessage: 'This will invalidate previously shared links. Continue?'}))
        if (accept) {
            await actions.teams.regenerateSignupToken()
            await actions.teams.refreshCurrentTeam()
            setWasCopied(false)

            const description = intl.formatMessage({id: 'RegistrationLink.tokenRegenerated', defaultMessage: 'Registration link regenerated'})
            sendFlashMessage({content: description, severity: 'low'})
        }
    }

    const registrationUrl = () => `${Utils.getBaseURL(true).replace(/\/$/, '')}/register?t=${signupToken()}`

    return (
        <Modal
            position='bottom-right'
            onClose={props.onClose}
        >
            <div class='RegistrationLink'>
                <Show when={signupToken()}>
                    <div class='row'>
                        {intl.formatMessage({id: 'RegistrationLink.description', defaultMessage: 'Share this link for others to create accounts:'})}
                    </div>
                    <div class='row'>
                        <a
                            class='shareUrl'
                            href={registrationUrl()}
                            target='_blank'
                            rel='noreferrer'
                        >
                            {registrationUrl()}
                        </a>
                        <Button
                            filled={true}
                            size='small'
                            onClick={() => {
                                Utils.copyTextToClipboard(registrationUrl())
                                setWasCopied(true)
                            }}
                        >
                            {wasCopied() ? intl.formatMessage({id: 'RegistrationLink.copiedLink', defaultMessage: 'Copied!'}) : intl.formatMessage({id: 'RegistrationLink.copyLink', defaultMessage: 'Copy link'})}
                        </Button>
                    </div>
                    <div class='row'>
                        <Button
                            onClick={regenerateToken}
                            emphasis='secondary'
                            size='small'
                        >
                            {intl.formatMessage({id: 'RegistrationLink.regenerateToken', defaultMessage: 'Regenerate token'})}
                        </Button>
                    </div>
                </Show>
            </div>
        </Modal>
    )
}

export default RegistrationLink
