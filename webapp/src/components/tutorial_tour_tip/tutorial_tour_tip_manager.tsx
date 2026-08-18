import {createEffect, createSignal, onCleanup, onMount} from 'solid-js'
import type {Accessor} from 'solid-js'

import {FINISHED, TourCategoriesMapToSteps, TOUR_ORDER} from '../onboardingTour'
import {useAppSelector, useAppStore} from '../../store/hooks'
import {getMe, getOnboardingTourStep} from '../../store/users'
import {UserConfigPatch} from '../../user'
import octoClient from '../../octoClient'
import {Utils, KeyCodes} from '../../utils'

export interface TutorialTourTipManager {
    show: Accessor<boolean>
    tourSteps: Record<string, number>
    getLastStep: () => number
    handleOpen: (e: MouseEvent) => void
    handleHide: (e?: MouseEvent) => void
    handleSkipTutorial: (e: MouseEvent) => void
    handleDismiss: (e: MouseEvent) => void
    handleSavePreferences: (step: number) => void
    handlePrevious: (e: MouseEvent) => void
    handleNext: (e?: MouseEvent) => void
    handleEventPropagationAndDefault: (e: MouseEvent | KeyboardEvent) => void
    handleSendToNextTour: (currentTourCategory: string) => Promise<void>
}

export type TutorialTourTipManagerProps = {
    autoTour?: boolean
    tutorialCategory: string
    step: number
    onNextNavigateTo?: () => void
    onPrevNavigateTo?: () => void
    stopPropagation?: boolean
    preventDefault?: boolean
}

const useTutorialTourTipManager = ({
    autoTour,
    tutorialCategory,
    onNextNavigateTo,
    onPrevNavigateTo,
    stopPropagation,
    preventDefault,
}: TutorialTourTipManagerProps): TutorialTourTipManager => {
    const [show, setShow] = createSignal(false)
    const tourSteps = TourCategoriesMapToSteps[tutorialCategory]

    const {actions} = useAppStore()
    const me = useAppSelector(getMe)
    const onboardingStep = useAppSelector(getOnboardingTourStep)
    const currentStep = () => parseInt(onboardingStep(), 10)
    const savePreferences = async (userID: string, stepValue: string, tourCategory?: string) => {
        const patch: UserConfigPatch = {
            updatedFields: {
                onboardingTourStep: stepValue,
            },
        }

        if (tourCategory) {
            patch.updatedFields!.tourCategory = tourCategory
        }

        const patchedProps = await octoClient.patchUserConfig(userID, patch)
        if (patchedProps) {
            actions.users.patchProps(patchedProps)
        }
    }

    const handleEventPropagationAndDefault = (e: MouseEvent | KeyboardEvent) => {
        if (stopPropagation) {
            e.stopPropagation()
        }
        if (preventDefault) {
            e.preventDefault()
        }
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
        if (Utils.isKeyPressed(e, KeyCodes.ENTER) && show()) {
            handleNext()
        }
    }

    createEffect(() => {
        if (autoTour) {
            setShow(true)
        }
    })

    onMount(() => {
        window.addEventListener('keydown', handleKeyDown)
        onCleanup(() =>
            window.removeEventListener('keydown', handleKeyDown))
    })

    const handleHide = (): void => {
        setShow(false)
    }

    const handleOpen = (e: MouseEvent): void => {
        handleEventPropagationAndDefault(e)
        setShow(true)
    }

    const handleDismiss = (e: MouseEvent): void => {
        handleEventPropagationAndDefault(e)
        handleHide()
    }

    const handleSavePreferences = async (nextStep: boolean | number): Promise<void> => {
        const currentUserId = me()?.id
        if (!currentUserId) {
            return
        }

        let stepValue = currentStep()
        if (nextStep === true) {
            stepValue += 1
        } else if (nextStep === false) {
            stepValue -= 1
        } else {
            stepValue = nextStep
        }
        handleHide()
        await savePreferences(currentUserId, stepValue.toString())
        if (onNextNavigateTo && nextStep === true && autoTour) {
            onNextNavigateTo()
        } else if (onPrevNavigateTo && nextStep === false && autoTour) {
            onPrevNavigateTo()
        }
    }

    const handlePrevious = (e: MouseEvent): void => {
        handleEventPropagationAndDefault(e)
        handleSavePreferences(false)
    }

    const handleNext = (e?: MouseEvent): void => {
        if (e) {
            handleEventPropagationAndDefault(e)
        }
        if (getLastStep() === currentStep()) {
            handleSavePreferences(FINISHED)
        } else {
            handleSavePreferences(true)
        }
    }

    const handleSkipTutorial = (e: MouseEvent): void => {
        handleEventPropagationAndDefault(e)
        const currentUserId = me()?.id
        if (currentUserId) {
            savePreferences(currentUserId, FINISHED.toString())
        }
    }

    const getLastStep = () => {
        return Object.values(tourSteps).reduce((maxStep, candidateMaxStep) => {
            // ignore the "opt out" FINISHED step as the max step.
            if (candidateMaxStep > maxStep && candidateMaxStep !== tourSteps.FINISHED) {
                return candidateMaxStep
            }
            return maxStep
        }, Number.MIN_SAFE_INTEGER)
    }

    const handleSendToNextTour = (currentTourCategory: string): Promise<void> => {
        const currentUserId = me()?.id
        if (!currentUserId) {
            return Promise.resolve()
        }

        const i = TOUR_ORDER.indexOf(currentTourCategory)
        if (i === -1) {
            Utils.logError(`Unknown tour category encountered: ${currentTourCategory}`)
        }

        let stepValue
        let tourCategory: string
        if (i === TOUR_ORDER.length - 1) {
            stepValue = FINISHED
            tourCategory = currentTourCategory
        } else {
            stepValue = 0
            tourCategory = TOUR_ORDER[i + 1]
        }

        return savePreferences(currentUserId, stepValue.toString(), tourCategory)
    }

    return {
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
    }
}

export default useTutorialTourTipManager
