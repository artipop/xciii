// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'
import {useLocation, useNavigate} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../intl'

import ErrorIllustration from '../svg/error-illustration'

import Button from '../widgets/buttons/button'
import './errorPage.scss'

import {errorDefFromId, ErrorId} from '../errors'

const ErrorPage = () => {
    const navigate = useNavigate()
    const queryParams = new URLSearchParams(useLocation().search)
    const errid = queryParams.get('id')
    const intl = useIntl()
    const errorDef = errorDefFromId(errid as ErrorId, intl)

    const handleButtonClick = (path: string | ((params: URLSearchParams) => string)) => {
        let url = '/'
        if (typeof path === 'function') {
            url = path(queryParams)
        } else if (path) {
            url = path as string
        }
        if (url === window.location.origin) {
            window.location.href = url
        } else {
            navigate(url)
        }
    }

    const makeButton = ((path: string | ((params: URLSearchParams) => string), txt: string, fill: boolean) => {
        return (
            <Button
                filled={fill}
                size='large'
                onClick={async () => {
                    handleButtonClick(path)
                }}
            >
                {txt}
            </Button>
        )
    })

    if (errid === ErrorId.NotLoggedIn) {
        handleButtonClick(errorDef.button1Redirect)
    }

    return (
        <div class='ErrorPage'>
            <div>
                <div class='title'>
                    <FormattedMessage
                        id='error.page.title'
                        defaultMessage={'Sorry, something went wrong'}
                    />
                </div>
                <div class='subtitle'>
                    {errorDef.title}
                </div>
                <ErrorIllustration/>
                <br/>
                <Show when={errorDef.button1Enabled}>
                    {makeButton(errorDef.button1Redirect, errorDef.button1Text, errorDef.button1Fill)}
                </Show>
                <Show when={errorDef.button2Enabled}>
                    {makeButton(errorDef.button2Redirect, errorDef.button2Text, errorDef.button2Fill)}
                </Show>
            </div>
        </div>
    )
}

export default ErrorPage
