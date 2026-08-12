import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {type Placement} from '@floating-ui/dom'

import {ClientConfig} from '../../../config/clientConfig'
import {getClientConfig} from '../../../store/clientConfig'

import {useAppSelector} from '../../../store/hooks'
import {getCurrentBoard} from '../../../store/boards'
import {getCurrentCard} from '../../../store/cards'
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

    // The tour runs on the board the person is actually on. It used to run only
    // on a board titled 'Welcome to Boards!' — a duplicate of Focalboard's demo
    // board, matched by its English title. Two things were wrong with that: the
    // board it named is not a board this app ever makes, and a title is a thing
    // a person renames, so the tour ended the moment they did.
    const onABoard = () => (props.showForce ? true : Boolean(board()))
    const disableTour = () => clientConfig()?.featureFlags?.disableTour || false

    const showTourTip = () => {
        const showTour = !disableTour() && onABoard() && onboardingTourStarted() && onboardingTourCategory() === props.category
        let show = showTour && onboardingTourStep() === props.step.toString()
        if (props.requireCard) {
            show = show && Boolean(currentCard())
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
                class={props.classname}
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
