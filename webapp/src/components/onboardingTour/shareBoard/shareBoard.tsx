import type {JSX} from 'solid-js'

import {FormattedMessage} from '../../../intl'

import {useMeasurePunchouts} from '../../tutorial_tour_tip/hooks'

import './shareBoard.scss'
import {Utils} from '../../../utils'
import shareBoard from '../../../../static/share.gif'

import {BoardTourSteps, TOUR_BOARD} from '../index'
import TourTipRenderer from '../tourTipRenderer/tourTipRenderer'

const ShareBoardTourStep = (): JSX.Element | null => {
    const title = (
        <FormattedMessage
            id='OnboardingTour.ShareBoard.Title'
            defaultMessage='Share the board'
        />
    )
    const screen = (
        <FormattedMessage
            id='OnboardingTour.ShareBoard.Body'
            defaultMessage='Publish the board behind a link, so somebody can look at it without an account of their own.'
        />
    )

    const punchout = useMeasurePunchouts(['.ShareBoardButton > button'])

    if (!BoardTourSteps.SHARE_BOARD) {
        return null
    }

    return (
        <TourTipRenderer
            requireCard={false}
            category={TOUR_BOARD}
            step={BoardTourSteps.SHARE_BOARD}
            screen={screen}
            title={title}
            punchout={punchout()}
            classname='ShareBoardTourStep'
            telemetryTag='tourPoint2b'
            placement={'bottom-end'}
            imageURL={Utils.buildURL(shareBoard, true)}
            hideBackdrop={true}
        />
    )
}

export default ShareBoardTourStep
