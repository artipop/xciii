// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect} from 'solid-js'
import {useLocation, useNavigate} from '@solidjs/router'

import {FormattedMessage} from '../../intl'

import BoardWelcomePNG from '../../../static/boards-welcome.png'
import BoardWelcomeSmallPNG from '../../../static/boards-welcome-small.png'

import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'
import {Utils} from '../../utils'

import './welcomePage.scss'
import mutator from '../../mutator'
import {useAppActions, useAppSelector} from '../../store/hooks'
import {IUser, UserConfigPatch} from '../../user'
import {getMe, getMyConfig} from '../../store/users'
import {getCurrentTeam, Team} from '../../store/teams'
import octoClient from '../../octoClient'
import {FINISHED, TOUR_ORDER} from '../../components/onboardingTour'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import {UserSettingKey} from '../../userSettings'

const WelcomePage = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const me = useAppSelector<IUser|null>(getMe)
    const myConfig = useAppSelector(getMyConfig)
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)
    const actions = useAppActions()

    const setWelcomePageViewed = async (userID: string): Promise<any> => {
        const patch: UserConfigPatch = {}
        patch.updatedFields = {}
        patch.updatedFields[UserSettingKey.WelcomePageViewed] = '1'

        const updatedProps = await mutator.patchUserConfig(userID, patch)
        if (updatedProps) {
            actions.users.patchProps(updatedProps)
        }
    }

    const goForward = () => {
        const queryString = new URLSearchParams(location.search)
        if (queryString.get('r')) {
            navigate(queryString.get('r')!, {replace: true})
            return
        }
        if (currentTeam()) {
            navigate(`/team/${currentTeam()!.id}`, {replace: true})
        } else {
            navigate('/', {replace: true})
        }
    }

    const skipTour = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.SkipTour)

        const user = me()
        if (user) {
            await setWelcomePageViewed(user.id)
            const patch: UserConfigPatch = {
                updatedFields: {
                    tourCategory: TOUR_ORDER[TOUR_ORDER.length - 1],
                    onboardingTourStep: FINISHED.toString(),
                },
            }

            const patchedProps = await octoClient.patchUserConfig(user.id, patch)
            if (patchedProps) {
                actions.users.patchProps(patchedProps)
            }
        }

        goForward()
    }

    const startTour = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.StartTour)

        const user = me()
        if (!user) {
            return
        }
        const team = currentTeam()
        if (!team) {
            return
        }

        await setWelcomePageViewed(user.id)
        const onboardingData = await octoClient.prepareOnboarding(team.id)
        await actions.users.fetchMe()
        const newPath = `/team/${onboardingData?.teamID}/${onboardingData?.boardID}`
        navigate(newPath, {replace: true})
    }

    // It's still possible for a guest to end up at this route/page directly, so
    // let's mark it as viewed, if necessary, and route them forward. A user who
    // has already seen the page is routed forward too — under React this was a
    // render-time redirect, here it is an effect of the same condition.
    const alreadyThrough = () => Boolean(me()?.is_guest) || Boolean(myConfig()[UserSettingKey.WelcomePageViewed])
    createEffect(() => {
        const user = me()
        if (user?.is_guest) {
            if (!myConfig()[UserSettingKey.WelcomePageViewed]) {
                setWelcomePageViewed(user.id)
            }
            goForward()
            return
        }
        if (myConfig()[UserSettingKey.WelcomePageViewed]) {
            goForward()
        }
    })

    return (
        <Show when={!alreadyThrough()}>
            <div class='WelcomePage'>
                <div class='wrapper'>
                    <h1 class='text-heading9'>
                        <FormattedMessage
                            id='WelcomePage.Heading'
                            defaultMessage='Welcome To Boards'
                        />
                    </h1>
                    <div class='WelcomePage__subtitle'>
                        <FormattedMessage
                            id='WelcomePage.Description'
                            defaultMessage='Boards is a project management tool that helps define, organize, track, and manage work across teams using a familiar Kanban board view.'
                        />
                    </div>

                    <div class='WelcomePage__content'>
                        {/* This image will be rendered on large screens over 2000px */}
                        <img
                            src={Utils.buildURL(BoardWelcomePNG, true)}
                            class='WelcomePage__image WelcomePage__image--large'
                            alt='Boards Welcome Image'
                        />

                        {/* This image will be rendered on small screens below 2000px */}
                        <img
                            src={Utils.buildURL(BoardWelcomeSmallPNG, true)}
                            class='WelcomePage__image WelcomePage__image--small'
                            alt='Boards Welcome Image'
                        />

                        <div class='WelcomePage__buttons'>
                            <Show when={me()?.is_guest !== true}>
                                <Button
                                    onClick={startTour}
                                    filled={true}
                                    size='large'
                                    icon={
                                        <CompassIcon
                                            icon='chevron-right'
                                            class='Icon Icon--right'
                                        />}
                                    rightIcon={true}
                                >
                                    <FormattedMessage
                                        id='WelcomePage.Explore.Button'
                                        defaultMessage='Take a tour'
                                    />
                                </Button>

                                <a
                                    class='skip'
                                    onClick={skipTour}
                                >
                                    <FormattedMessage
                                        id='WelcomePage.NoThanks.Text'
                                        defaultMessage="No thanks, I'll figure it out myself"
                                    />
                                </a>
                            </Show>
                            <Show when={me()?.is_guest === true}>
                                <Button
                                    onClick={skipTour}
                                    filled={true}
                                    size='large'
                                >
                                    <FormattedMessage
                                        id='WelcomePage.StartUsingIt.Text'
                                        defaultMessage='Start using it'
                                    />
                                </Button>
                            </Show>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    )
}

export default WelcomePage
