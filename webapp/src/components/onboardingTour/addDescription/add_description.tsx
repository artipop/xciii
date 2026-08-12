import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import './add_description.scss'
import {Utils} from '../../../utils'
import addDescription from '../../../../static/addDescription.png'

import {CardTourSteps, TOUR_CARD} from '../index'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

const AddDescriptionTourStep = (): JSX.Element | null => {
    const title = (
        <FormattedMessage
            id='OnboardingTour.AddDescription.Title'
            defaultMessage='Description'
        />
    )
    const screen = (
        <FormattedMessage
            id='OnboardingTour.AddDescription.Body'
            defaultMessage='The description is the task itself, and it is what an agent is given to work from, so it is worth writing plainly.'
        />
    )

    const punchout = useMeasurePunchouts(['.octo-content div:nth-child(1)'])

    return (
        <TourTipRenderer
            requireCard={true}
            category={TOUR_CARD}
            step={CardTourSteps.ADD_DESCRIPTION}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='AddDescriptionTourStep'
            telemetryTag='tourPoint2c'
            placement={'top-start'}
            imageURL={Utils.buildURL(addDescription, true)}
            hideBackdrop={true}
        />
    )
}

export default AddDescriptionTourStep
