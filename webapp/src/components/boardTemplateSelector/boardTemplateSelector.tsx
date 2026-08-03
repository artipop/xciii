// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createEffect, createMemo, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {useNavigate} from '@solidjs/router'

import {useHotkeys} from '../../hooks/hotkeys'
import {useRouteMatch} from '../../hooks/routerMatch'
import CompassIcon from '../../widgets/icons/compassIcon'

import {Board} from '../../blocks/board'
import IconButton from '../../widgets/buttons/iconButton'
import CloseIcon from '../../widgets/icons/close'
import Button from '../../widgets/buttons/button'
import octoClient from '../../octoClient'
import mutator from '../../mutator'
import {getTemplates, getCurrentBoardId} from '../../store/boards'
import {getCurrentTeam, Team} from '../../store/teams'
import {getGlobalTemplates} from '../../store/globalTemplates'
import {useAppSelector, useAppStore} from '../../store/hooks'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

import './boardTemplateSelector.scss'
import {OnboardingBoardTitle} from '../cardDetail/cardDetail'
import {IUser, UserConfigPatch} from '../../user'
import {getMe} from '../../store/users'
import {BaseTourSteps, TOUR_BASE} from '../onboardingTour'

import {Utils} from '../../utils'

import {Constants} from '../../constants'

import BoardTemplateSelectorPreview from './boardTemplateSelectorPreview'
import BoardTemplateSelectorItem from './boardTemplateSelectorItem'

type Props = {
    title?: JSX.Element
    description?: JSX.Element
    onClose?: () => void
    channelId?: string
}

// Only this template is offered in the selector; every other template
// (default templates, the onboarding board, user-created ones) is hidden.
const VISIBLE_TEMPLATE_TITLE = 'My Project Tasks'

const BoardTemplateSelector = (props: Props) => {
    const globalTemplates = useAppSelector<Board[]>(getGlobalTemplates)
    const currentBoardId = useAppSelector<string>(getCurrentBoardId)
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)
    const {actions} = useAppStore()
    const intl = useIntl()
    const navigate = useNavigate()
    const match = useRouteMatch()
    const me = useAppSelector<IUser|null>(getMe)

    useHotkeys('esc', () => props.onClose?.())

    const showBoard = async (boardId: string | null) => {
        if (!boardId) {
            return
        }
        Utils.showBoard(boardId, match(), navigate)
        if (props.onClose) {
            props.onClose()
        }
    }

    onMount(() => {
        if (octoClient.teamId !== Constants.globalTeamId && (globalTemplates() || []).length === 0) {
            actions.globalTemplates.fetchGlobalTemplates()
        }
    })

    const onBoardTemplateDelete = (template: Board) => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DeleteBoardTemplate, {board: template.id})
        mutator.deleteBoard(
            template,
            intl.formatMessage({id: 'BoardTemplateSelector.delete-template', defaultMessage: 'Delete'}),
            async () => {},
            async () => {
                showBoard(template.id)
            },
        )
    }

    const unsortedTemplates = useAppSelector(getTemplates)
    const allTemplates = createMemo(() => {
        const templates = Object.values(unsortedTemplates()).sort((a: Board, b: Board) => a.createAt - b.createAt)
        return (globalTemplates() || []).concat(templates).filter((template) => template.title === VISIBLE_TEMPLATE_TITLE)
    })

    const resetTour = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.StartTour)

        const user = me()
        if (!user) {
            return
        }

        const patch: UserConfigPatch = {
            updatedFields: {
                onboardingTourStarted: '1',
                onboardingTourStep: BaseTourSteps.OPEN_A_CARD.toString(),
                tourCategory: TOUR_BASE,
            },
        }

        const patchedProps = await octoClient.patchUserConfig(user.id, patch)
        if (patchedProps) {
            actions.users.patchProps(patchedProps)
        }
    }

    const [activeTemplate, setActiveTemplate] = createSignal<Board>(allTemplates()[0])

    createEffect(() => {
        if (!activeTemplate()) {
            setActiveTemplate(allTemplates()[0])
        }
    })

    const handleUseTemplate = async () => {
        const template = activeTemplate()
        if (template.teamId === '0') {
            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.CreateBoardViaTemplate, {boardTemplateId: template.properties.trackingTemplateId as string, channelID: props.channelId})
        }

        const boardsAndBlocks = await mutator.addBoardFromTemplate(currentTeam()?.id || Constants.globalTeamId, intl, showBoard, () => showBoard(currentBoardId()), template.id, currentTeam()?.id)
        const board = boardsAndBlocks.boards[0]
        await mutator.updateBoard({...board, channelId: props.channelId || ''}, board, 'linked channel')
        if (template.title === OnboardingBoardTitle) {
            resetTour()
        }
    }

    return (
        <Show when={allTemplates()}>
            <div class={`BoardTemplateSelector__container ${props.onClose ? '' : 'BoardTemplateSelector__container--page'}`}>
                <Show when={props.onClose}>
                    <div
                        onClick={props.onClose}
                        class='BoardTemplateSelector__backdrop'
                    />
                </Show>
                <div class='BoardTemplateSelector'>
                    <div class='toolbar'>
                        <Show when={props.onClose}>
                            <IconButton
                                size='medium'
                                onClick={props.onClose}
                                icon={<CloseIcon/>}
                                title={'Close'}
                            />
                        </Show>
                    </div>
                    <div class='header'>
                        <h1 class='title'>
                            {props.title || (
                                <FormattedMessage
                                    id='BoardTemplateSelector.title'
                                    defaultMessage='Create a board'
                                />
                            )}
                        </h1>
                        <p class='description'>
                            {props.description || (
                                <FormattedMessage
                                    id='BoardTemplateSelector.description'
                                    defaultMessage='Add a board to the sidebar using any of the templates defined below or start from scratch.'
                                />
                            )}
                        </p>
                    </div>
                    <div class='templates'>
                        <div class='templates-sidebar'>
                            <div class='templates-list'>
                                <Button
                                    emphasis='link'
                                    size='medium'
                                    icon={<CompassIcon icon='plus'/>}
                                    className='new-template'
                                    onClick={() => mutator.addEmptyBoardTemplate(currentTeam()?.id || '', intl, showBoard, () => showBoard(currentBoardId()))}
                                >
                                    <FormattedMessage
                                        id='BoardTemplateSelector.add-template'
                                        defaultMessage='Create new template'
                                    />
                                </Button>
                                <For each={allTemplates()}>
                                    {(boardTemplate) => (
                                        <BoardTemplateSelectorItem
                                            isActive={activeTemplate()?.id === boardTemplate.id}
                                            template={boardTemplate}
                                            onSelect={setActiveTemplate}
                                            onDelete={onBoardTemplateDelete}
                                            onEdit={showBoard}
                                        />
                                    )}
                                </For>
                            </div>
                            <div class='templates-sidebar__footer'>
                                <Button
                                    emphasis='secondary'
                                    size={'medium'}
                                    icon={<CompassIcon icon='kanban'/>}
                                    onClick={async () => {
                                        const boardsAndBlocks = await mutator.addEmptyBoard(currentTeam()?.id || '', intl, showBoard, () => showBoard(currentBoardId()))
                                        const board = boardsAndBlocks.boards[0]
                                        await mutator.updateBoard({...board, channelId: props.channelId || ''}, board, 'linked channel')
                                    }}
                                >
                                    <FormattedMessage
                                        id='BoardTemplateSelector.create-empty-board'
                                        defaultMessage='Create empty board'
                                    />
                                </Button>
                            </div>
                        </div>
                        <div class='templates-content'>
                            <div class='template-preview-box'>
                                <BoardTemplateSelectorPreview activeTemplate={activeTemplate()}/>
                            </div>
                            <div class='buttons'>
                                <Button
                                    filled={true}
                                    size={'medium'}
                                    onClick={handleUseTemplate}
                                >
                                    <FormattedMessage
                                        id='BoardTemplateSelector.use-this-template'
                                        defaultMessage='Use this template'
                                    />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    )
}

export default BoardTemplateSelector
