import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import './add_view.scss'
import {Utils} from '../../../utils'
import changeViews from '../../../../static/changeViews.gif'

import {BoardTourSteps, TOUR_BOARD} from '../index'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

const AddViewTourStep = (): JSX.Element => {
    const title = (
        <FormattedMessage
            id='OnboardingTour.AddView.Title'
            defaultMessage='Add a view'
        />
    )
    const screen = (
        <FormattedMessage
            id='OnboardingTour.AddView.Body'
            defaultMessage='A view is one way of looking at the same cards: a kanban, a table, a calendar. A board can carry as many as it needs.'
        />
    )

    const punchout = useMeasurePunchouts(['.viewSelector'])

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_BOARD}
            step={BoardTourSteps.ADD_VIEW}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='AddViewTourStep'
            telemetryTag='tourPoint3a'
            placement={'bottom-start'}
            imageURL={Utils.buildURL(changeViews, true)}
            hideBackdrop={false}
        />
    )
}

export default AddViewTourStep
