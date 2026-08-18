import {For, Show, createEffect, createSignal, createUniqueId, onCleanup} from 'solid-js'
import {Portal} from 'solid-js/web'
import type {JSX, ParentComponent} from 'solid-js'

import {arrow, autoUpdate, computePosition, flip, offset, shift, type Placement} from '@floating-ui/dom'

import {FormattedMessage, useIntl} from '../../intl'

import './tutorial_tour_tip.scss'

import CloseIcon from '../../widgets/icons/close'
import Button from '../../widgets/buttons/button'
import IconButton from '../../widgets/buttons/iconButton'
import CompassIcon from '../../widgets/icons/compassIcon'

import PulsatingDot from '../pulsating_dot'

import TutorialTourTipBackdrop, {Coords, TutorialTourTipPunchout} from './tutorial_tour_tip_backdrop'

import useTutorialTourTipManager, {TutorialTourTipManagerProps} from './tutorial_tour_tip_manager'

const TourTipOverlay: ParentComponent<{show: boolean, onClick: (e: MouseEvent) => void}> = (props) => (
    <Show when={props.show}>
        <Portal mount={document.body}>
            <div
                class='tutorial-tour-tip__overlay'
                onClick={props.onClick}
            >
                {props.children}
            </div>
        </Portal>
    </Show>
)

// The arrow is a 12px square turned 45 degrees, so its corner reaches about
// 8.5px out of the box; 10px of offset keeps it clear of what it points at,
// which is the gap tippy left as well.
const ARROW_SIZE = 12
const TIP_OFFSET = 10
const VIEWPORT_PADDING = 8

const oppositeSide: Record<string, 'top' | 'right' | 'bottom' | 'left'> = {
    top: 'bottom',
    right: 'left',
    bottom: 'top',
    left: 'right',
}

type TipPosition = {
    x: number
    y: number
    placement: Placement
    arrowX?: number
    arrowY?: number
}

type TourTipBoxProps = {
    anchor: () => HTMLElement | undefined
    placement?: Placement
    width: string | number
    class?: string
    labelledBy: string
    children: JSX.Element
}

// What Tippy was here for. The box is portalled to the body and placed against
// the pulsating dot by Floating UI, which — unlike tippy.js, whose author moved
// on to write it — has no framework in it: the port kept everything below the
// return statement and rewrote the rest, exactly as predicted.
//
// The translation goes on the positioner and the entrance animation on the box
// inside it, so the two never fight over `transform`.
const TourTipBox = (props: TourTipBoxProps): JSX.Element => {
    const [positioner, setPositioner] = createSignal<HTMLDivElement | null>(null)
    const [arrowElement, setArrowElement] = createSignal<HTMLDivElement | null>(null)
    const [position, setPosition] = createSignal<TipPosition | null>(null)

    createEffect(() => {
        const reference = props.anchor()
        const positionerEl = positioner()
        const arrowEl = arrowElement()
        if (!reference || !positionerEl || !arrowEl) {
            return
        }

        // Keeps the box on the dot while the board behind it scrolls or resizes.
        const stop = autoUpdate(reference, positionerEl, () => {
            computePosition(reference, positionerEl, {
                placement: props.placement || 'top',
                middleware: [
                    offset(TIP_OFFSET),
                    flip(),
                    shift({padding: VIEWPORT_PADDING}),
                    arrow({element: arrowEl, padding: VIEWPORT_PADDING}),
                ],
            }).then((computed) => {
                setPosition({
                    x: computed.x,
                    y: computed.y,
                    placement: computed.placement,
                    arrowX: computed.middlewareData.arrow?.x,
                    arrowY: computed.middlewareData.arrow?.y,
                })
            })
        })
        onCleanup(stop)
    })

    const resolved = () => position()?.placement || props.placement || 'top'
    const arrowStyle = (): JSX.CSSProperties => ({
        left: position()?.arrowX === undefined ? undefined : `${position()!.arrowX}px`,
        top: position()?.arrowY === undefined ? undefined : `${position()!.arrowY}px`,
        [oppositeSide[resolved().split('-')[0]]]: `${-ARROW_SIZE / 2}px`,
    })

    return (
        <Portal mount={document.body}>
            <div
                ref={setPositioner}

                // Nothing is drawn until there is somewhere to draw it, so the box
                // never appears at the top-left corner for a frame first.
                class={`tutorial-tour-tip__positioner ${position() ? 'is-positioned' : ''}`}
                data-placement={resolved()}
                style={position() ? {transform: `translate(${Math.round(position()!.x)}px, ${Math.round(position()!.y)}px)`} : undefined}
            >
                <div
                    class={`tutorial-tour-tip__box ${props.class || ''}`}
                    style={{'max-width': typeof props.width === 'number' ? `${props.width}px` : props.width}}
                    role='dialog'
                    aria-labelledby={props.labelledBy}
                >
                    <div
                        ref={setArrowElement}
                        class='tutorial-tour-tip__arrow'
                        style={arrowStyle()}
                    />
                    {props.children}
                </div>
            </div>
        </Portal>
    )
}

type Props = {
    screen: JSX.Element
    title: JSX.Element
    imageURL?: string
    punchOut?: TutorialTourTipPunchout | null
    step: number
    singleTip?: boolean
    showOptOut?: boolean
    placement?: Placement
    stopPropagation?: boolean
    preventDefault?: boolean
    tutorialCategory: string
    onNextNavigateTo?: () => void
    onPrevNavigateTo?: () => void
    autoTour?: boolean
    pulsatingDotPosition?: Coords | undefined
    width?: string | number
    class?: string
    hideNavButtons?: boolean
    hideBackdrop?: boolean
    clickThroughPunchhole?: boolean
    onPunchholeClick?: (e: MouseEvent) => void
    skipCategoryFromBackdrop?: boolean
}

const TutorialTourTip = (props: Props): JSX.Element => {
    const intl = useIntl()
    const stopPropagation = () => props.stopPropagation ?? true
    const preventDefault = () => props.preventDefault ?? true
    const width = () => props.width ?? (window.innerWidth > 2559 ? 500 : 320)
    const hideNavButtons = () => props.hideNavButtons ?? false
    const hideBackdrop = () => props.hideBackdrop ?? false

    const managerProps: TutorialTourTipManagerProps = {
        step: props.step,
        autoTour: props.autoTour,
        tutorialCategory: props.tutorialCategory,
        onNextNavigateTo: props.onNextNavigateTo,
        onPrevNavigateTo: props.onPrevNavigateTo,
        stopPropagation: stopPropagation(),
        preventDefault: preventDefault(),
    }

    let triggerRef: HTMLDivElement | undefined
    const titleId = createUniqueId()
    const {
        show,
        tourSteps,
        handleOpen,
        handleHide,
        handleDismiss,
        handleNext,
        handlePrevious,
        handleSkipTutorial,
        handleSavePreferences,
        getLastStep,
        handleEventPropagationAndDefault,
        handleSendToNextTour,
    } = useTutorialTourTipManager(managerProps)

    const getButtonText = (): JSX.Element => {
        if (props.singleTip) {
            return (
                <FormattedMessage
                    id={'tutorial_tip.got_it'}
                    defaultMessage={'Got it'}
                />
            )
        }

        const lastStep = getLastStep()
        if (props.step === lastStep) {
            return (
                <FormattedMessage
                    id={'tutorial_tip.finish_tour'}
                    defaultMessage={'Done'}
                />
            )
        }

        return (
            <FormattedMessage
                id={'tutorial_tip.ok'}
                defaultMessage={'Next'}
            />
        )
    }

    const dotIndexes = () => (!props.singleTip && tourSteps ? Object.values(tourSteps).map((_, i) => i) : [])

    const content = (
        <div
            onClick={(e) => {
                e.stopPropagation()
            }}
        >
            <div class='tutorial-tour-tip__header'>
                <h4
                    id={titleId}
                    class='tutorial-tour-tip__header__title'
                >
                    {props.title}
                </h4>
                <IconButton
                    class='tutorial-tour-tip__header__close'
                    size='small'
                    icon={<CloseIcon/>}
                    onClick={(e: MouseEvent) => {
                        if (props.skipCategoryFromBackdrop) {
                            handleDismiss(e)
                            handleSendToNextTour(props.tutorialCategory)
                        }
                    }}
                />
            </div>
            <div class='tutorial-tour-tip__body'>
                {props.screen}
            </div>
            <Show when={props.imageURL}>
                <div class='tutorial-tour-tip__image'>
                    <img
                        src={props.imageURL}
                        alt={'tutorial tour tip product image'}
                    />
                </div>
            </Show>
            <div class='tutorial-tour-tip__footer'>
                <div class='tutorial-tour-tip__footer-buttons'>
                    <div class='tutorial-tour-tip__circles-ctr'>
                        <For each={dotIndexes()}>
                            {(i) => (
                                <div
                                    class={`tutorial-tour-tip__circular-ring ${i === props.step ? 'tutorial-tour-tip__circular-ring-active' : ''}`}
                                >
                                    <a
                                        href='#'
                                        class={`tutorial-tour-tip__circle ${i === props.step ? 'active' : ''}`}
                                        data-screen={i}
                                        onClick={() => handleSavePreferences(i)}
                                    />
                                </div>
                            )}
                        </For>
                    </div>
                    <div class={'tutorial-tour-tip__btn-ctr'}>
                        <Show when={!hideNavButtons() && props.step !== 0}>
                            <Button
                                title={intl.formatMessage({id: 'generic.previous', defaultMessage: 'Previous'})}
                                size='small'
                                emphasis='tertiary'
                                onClick={handlePrevious}
                                icon={
                                    <CompassIcon
                                        class='icon'
                                        icon='chevron-left'
                                    />}
                            >
                                <FormattedMessage
                                    id='generic.previous'
                                    defaultMessage='Previous'
                                />
                            </Button>
                        </Show>

                        <Show when={!hideNavButtons()}>
                            <Button
                                class='tipNextButton'
                                size='small'
                                filled={true}
                                onClick={handleNext}
                                rightIcon={true}
                                icon={(props.singleTip || props.step === getLastStep()) ? '' : (
                                    <CompassIcon
                                        class='icon'
                                        icon='chevron-right'
                                    />
                                )
                                }
                            >
                                {getButtonText()}
                            </Button>
                        </Show>
                    </div>
                </div>
                <Show when={props.showOptOut}>
                    <div class='tutorial-tour-tip__opt'>
                        <FormattedMessage
                            id='tutorial_tip.seen'
                            defaultMessage='Seen this before? '
                        />
                        <a
                            href='#'
                            onClick={handleSkipTutorial}
                        >
                            <FormattedMessage
                                id='tutorial_tip.out'
                                defaultMessage='Opt out of these tips.'
                            />
                        </a>
                    </div>
                </Show>
            </div>
        </div>
    )

    return (
        <>
            <div
                ref={triggerRef}
                onClick={handleOpen}
                aria-expanded={show()}
                class={`tutorial-tour-tip__pulsating-dot-ctr ${props.class || ''}`}
            >
                <PulsatingDot coords={props.pulsatingDotPosition}/>
            </div>
            <TourTipOverlay
                show={!hideBackdrop() && show()}
                onClick={(e) => {
                    handleEventPropagationAndDefault(e)
                    handleHide(e)
                    if (props.onPunchholeClick) {
                        props.onPunchholeClick(e)
                    }
                }}
            >
                <TutorialTourTipBackdrop
                    x={props.punchOut?.x}
                    y={props.punchOut?.y}
                    width={props.punchOut?.width}
                    height={props.punchOut?.height}
                    handleClick={(e) => {
                        if (props.skipCategoryFromBackdrop) {
                            e.preventDefault()
                            e.stopPropagation()
                            handleSendToNextTour(props.tutorialCategory)
                        }
                    }}
                />
            </TourTipOverlay>
            <Show when={show()}>
                <TourTipBox
                    anchor={() => triggerRef}
                    placement={props.placement}
                    width={width()}
                    class={props.class}
                    labelledBy={titleId}
                >
                    {content}
                </TourTipBox>
            </Show>
        </>
    )
}

export default TutorialTourTip
