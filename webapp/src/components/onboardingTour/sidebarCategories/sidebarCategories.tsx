import {onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'
import {TOUR_BOARD, TOUR_SIDEBAR, SidebarTourSteps, FINISHED} from '../index'
import {useAppSelector, useAppStore} from '../../../store/hooks'
import {
    getMe,
    getOnboardingTourCategory,
    getOnboardingTourStep,
} from '../../../store/users'
import {IUser, UserConfigPatch} from '../../../user'
import mutator from '../../../mutator'
import {Constants} from '../../../constants'

import './sidebarCategories.scss'

const SidebarCategoriesTourStep = (): JSX.Element => {
    const title = (
        <FormattedMessage
            id='SidebarTour.SidebarCategories.Title'
            defaultMessage='Boards in the sidebar'
        />
    )

    // One message and no link. This step used to explain a Mattermost 7.2
    // upgrade that turned workspaces into sidebar categories, and pointed at
    // release notes on docs.mattermost.com — an announcement about a product
    // this is not, addressed to people who had upgraded something they never had.
    const screen = (
        <FormattedMessage
            id='SidebarTour.SidebarCategories.Body'
            defaultMessage='Every board is listed here. Drag one into a category of your own to keep the list in an order that suits you.'
        />
    )

    const punchout = useMeasurePunchouts(['.SidebarCategory'])

    const me = useAppSelector<IUser|null>(getMe)
    const {actions} = useAppStore()
    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)

    onMount(() => {
        async function task() {
            const user = me()
            if (!user) {
                return
            }

            const should = onboardingTourCategory() === TOUR_BOARD &&
                           onboardingTourStep() === FINISHED.toString()

            if (!should) {
                return
            }

            const patch: UserConfigPatch = {}
            patch.updatedFields = {}
            patch.updatedFields.tourCategory = TOUR_SIDEBAR
            patch.updatedFields.onboardingTourStep = SidebarTourSteps.SIDE_BAR.toString()
            patch.updatedFields.lastWelcomeVersion = Constants.versionString

            const updatedProps = await mutator.patchUserConfig(user.id, patch)
            if (updatedProps) {
                actions.users.patchProps(updatedProps)
            }
        }

        task()
    })

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_SIDEBAR}
            step={SidebarTourSteps.SIDE_BAR}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='SidebarCategories'
            telemetryTag='tourPoint4a'
            placement={'right'}
            hideBackdrop={false}
            showForce={true}
        />
    )
}

export default SidebarCategoriesTourStep
