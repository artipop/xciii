import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import './copy_link.scss'
import {Utils} from '../../../utils'
import copyLink from '../../../../static/copyLink.gif'

import {BoardTourSteps, TOUR_BOARD} from '../index'
import {FirstCardSelector} from '../../kanban/kanbanCard'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

const CopyLinkTourStep = (): JSX.Element | null => {
    const title = (
        <FormattedMessage
            id='OnboardingTour.CopyLink.Title'
            defaultMessage='Copy link'
        />
    )
    const screen = (
        <FormattedMessage
            id='OnboardingTour.CopyLink.Body'
            defaultMessage='A link points at one card and opens it wherever the board is reached: the window, a browser, a phone.'
        />
    )

    const punchout = useMeasurePunchouts([`${FirstCardSelector} .optionsMenu`])

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_BOARD}
            step={BoardTourSteps.COPY_LINK}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='CopyLinkTourStep'
            telemetryTag='tourPoint3b'
            placement={'right-start'}
            imageURL={Utils.buildURL(copyLink, true)}
            hideBackdrop={true}
        />
    )
}

export default CopyLinkTourStep
