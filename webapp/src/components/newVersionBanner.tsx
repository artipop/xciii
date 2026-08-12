import {Show, createSignal, onMount} from 'solid-js'

import {FormattedMessage} from '../intl'

import wsClient from '../wsclient'

import './newVersionBanner.scss'

const NewVersionBanner = () => {
    const [appVersionChanged, setAppVersionChanged] = createSignal(false)
    onMount(() => {
        wsClient.onAppVersionChangeHandler = setAppVersionChanged
    })

    const newVersionReload = (e: Event) => {
        e.preventDefault()
        location.reload()
    }

    return (
        <Show when={appVersionChanged()}>
            <div class='NewVersionBanner'>
                <a
                    target='_blank'
                    rel='noreferrer'
                    onClick={newVersionReload}
                >
                    <FormattedMessage
                        id='BoardPage.newVersion'
                        defaultMessage='A new version of Boards is available, click here to reload.'
                    />
                </a>
            </div>
        </Show>
    )
}

export default NewVersionBanner
