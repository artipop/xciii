import {Show, createEffect} from 'solid-js'
import {useLocation, useNavigate} from '@solidjs/router'

import {FormattedMessage} from '../../intl'

import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'

import './welcomePage.scss'
import mutator from '../../mutator'
import {useAppActions, useAppSelector} from '../../store/hooks'
import {IUser, UserConfigPatch} from '../../user'
import {getMe, getMyConfig} from '../../store/users'
import {getCurrentTeam, Team} from '../../store/teams'
import octoClient from '../../octoClient'
import {BaseTourSteps, FINISHED, TOUR_BASE, TOUR_ORDER} from '../../components/onboardingTour'
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

    // The tour runs on the person's own board, so starting it is only a matter of
    // saying so and going forward: whichever board they open next — an existing
    // one, or the one they are about to make from a template — is where the tips
    // appear. This used to POST /onboard, which duplicated Focalboard's English
    // demo board into the team and sent the person there instead.
    const startTour = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.StartTour)

        const user = me()
        if (!user) {
            return
        }

        await setWelcomePageViewed(user.id)
        const patch: UserConfigPatch = {
            updatedFields: {
                onboardingTourStarted: '1',
                tourCategory: TOUR_BASE,
                onboardingTourStep: BaseTourSteps.OPEN_A_CARD.toString(),
            },
        }
        const patchedProps = await octoClient.patchUserConfig(user.id, patch)
        if (patchedProps) {
            actions.users.patchProps(patchedProps)
        }

        goForward()
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
                            defaultMessage='Welcome to XCIII'
                        />
                    </h1>
                    <div class='WelcomePage__subtitle'>
                        <FormattedMessage
                            id='WelcomePage.Description'
                            defaultMessage='A board where the work gets done: cards you move, columns that put an agent on a card when it lands in them, and a terminal for when it is easier to do it yourself.'
                        />
                    </div>

                    <div class='WelcomePage__content'>
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
                                        defaultMessage='Show me around'
                                    />
                                </Button>

                                <a
                                    class='skip'
                                    onClick={skipTour}
                                >
                                    <FormattedMessage
                                        id='WelcomePage.NoThanks.Text'
                                        defaultMessage="No thanks, I'll find my way"
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
