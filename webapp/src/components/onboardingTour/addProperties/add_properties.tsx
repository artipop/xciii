import {createEffect} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import './add_properties.scss'
import {Utils} from '../../../utils'
import addProperty from '../../../../static/addProperty.gif'

import {BaseTourSteps, CardTourSteps, TOUR_BASE, TOUR_CARD} from '../index'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'
import {useAppSelector, useAppStore} from '../../../store/hooks'
import {
    getMe,
    getOnboardingTourCategory,
    getOnboardingTourStarted,
    getOnboardingTourStep,
} from '../../../store/users'
import {IUser, UserConfigPatch} from '../../../user'
import mutator from '../../../mutator'
import {getCurrentBoard} from '../../../store/boards'
import {getCurrentCard} from '../../../store/cards'

const AddPropertiesTourStep = (): JSX.Element => {
    const title = (
        <FormattedMessage
            id='OnboardingTour.AddProperties.Title'
            defaultMessage='Card properties'
        />
    )
    const screen = (
        <FormattedMessage
            id='OnboardingTour.AddProperties.Body'
            defaultMessage='Properties are what the board groups, sorts and filters by: who is doing the card, which project it belongs to, what stage it stands on.'
        />
    )

    const punchout = useMeasurePunchouts(['.octo-propertyname.add-property'])

    const me = useAppSelector<IUser|null>(getMe)
    const {actions} = useAppStore()

    const board = useAppSelector(getCurrentBoard)
    const card = useAppSelector(getCurrentCard)

    const onboardingTourStarted = useAppSelector(getOnboardingTourStarted)
    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)

    // Opening a card is what the base tour asks for, so opening any card is what
    // finishes it and hands over to the card tour. It used to have to be one
    // particular card on one particular board, both matched by their English
    // titles, which is a match no board this app makes could ever satisfy.
    createEffect(() => {
        async function task() {
            const user = me()
            const currentCard = card()
            if (!user || !currentCard || !board()) {
                return
            }

            const should = currentCard.id &&
                onboardingTourStarted() &&
                onboardingTourCategory() === TOUR_BASE &&
                onboardingTourStep() === BaseTourSteps.OPEN_A_CARD.toString()

            if (!should) {
                return
            }

            const patch: UserConfigPatch = {}
            patch.updatedFields = {}
            patch.updatedFields.tourCategory = TOUR_CARD
            patch.updatedFields.onboardingTourStep = CardTourSteps.ADD_PROPERTIES.toString()

            const updatedProps = await mutator.patchUserConfig(user.id, patch)
            if (updatedProps) {
                actions.users.patchProps(updatedProps)
            }
        }

        task()
    })

    return (
        <TourTipRenderer
            requireCard={true}
            category={TOUR_CARD}
            step={CardTourSteps.ADD_PROPERTIES}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='AddPropertiesTourStep'
            telemetryTag='tourPoint2a'
            placement={'right-end'}
            imageURL={Utils.buildURL(addProperty, true)}
            hideBackdrop={true}
        />
    )
}

export default AddPropertiesTourStep
