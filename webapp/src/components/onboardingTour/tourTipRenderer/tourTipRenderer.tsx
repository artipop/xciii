// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {type Placement} from '@floating-ui/dom'

import {ClientConfig} from '../../../config/clientConfig'
import {getClientConfig} from '../../../store/clientConfig'

import {useAppSelector} from '../../../store/hooks'
import {getCurrentBoard} from '../../../store/boards'
import {getCurrentCard} from '../../../store/cards'
import {OnboardingBoardTitle, OnboardingCardTitle} from '../../cardDetail/cardDetail'
import {getOnboardingTourCategory, getOnboardingTourStarted, getOnboardingTourStep} from '../../../store/users'
import TourTip from '../../tutorial_tour_tip/tutorial_tour_tip'
import {TutorialTourTipPunchout} from '../../tutorial_tour_tip/tutorial_tour_tip_backdrop'

type Props = {
    requireCard: boolean
    category: string
    step: number
    screen: JSX.Element
    title: JSX.Element
    punchout: TutorialTourTipPunchout | null | undefined
    classname: string
    telemetryTag: string
    placement: Placement | undefined
    hideBackdrop: boolean
    imageURL?: string
    singleTip?: boolean
    hideNavButtons?: boolean
    showForce?: boolean
}

const TourTipRenderer = (props: Props): JSX.Element | null => {
    const board = useAppSelector(getCurrentBoard)
    const clientConfig = useAppSelector<ClientConfig>(getClientConfig)

    const onboardingTourStarted = useAppSelector(getOnboardingTourStarted)
    const onboardingTourCategory = useAppSelector(getOnboardingTourCategory)
    const onboardingTourStep = useAppSelector(getOnboardingTourStep)
    const currentCard = useAppSelector((state) => (props.requireCard ? getCurrentCard(state) : null))

    const isOnboardingBoard = () => (props.showForce ? true : Boolean(board() && board()!.title === OnboardingBoardTitle))
    const disableTour = () => clientConfig()?.featureFlags?.disableTour || false

    const showTourTip = () => {
        const showTour = !disableTour() && isOnboardingBoard() && onboardingTourStarted() && onboardingTourCategory() === props.category
        let show = showTour && onboardingTourStep() === props.step.toString()
        if (props.requireCard) {
            show = show && Boolean(currentCard() && currentCard()!.title === OnboardingCardTitle)
        }
        return show
    }

    const currentStep = () => parseInt(onboardingTourStep(), 10)

    return (
        <Show when={showTourTip()}>
            <TourTip
                screen={props.screen}
                title={props.title}
                punchOut={props.punchout}
                step={currentStep()}
                tutorialCategory={props.category}
                placement={props.placement}
                className={props.classname}
                imageURL={props.imageURL}
                telemetryTag={props.telemetryTag}
                skipCategoryFromBackdrop={true}
                autoTour={true}
                hideBackdrop={props.hideBackdrop}
                singleTip={props.singleTip}
                hideNavButtons={props.hideNavButtons}
            />
        </Show>
    )
}

export default TourTipRenderer
