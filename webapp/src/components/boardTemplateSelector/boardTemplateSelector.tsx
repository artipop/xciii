// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import React, {useEffect, useState} from 'react'
import {FormattedMessage, useIntl} from '../../intl'
import {useHistory, useRouteMatch} from 'react-router-dom'

import {useHotkeys} from '../../hooks/hotkeys'
import CompassIcon from '../../widgets/icons/compassIcon'

import {Board} from '../../blocks/board'
import IconButton from '../../widgets/buttons/iconButton'
import CloseIcon from '../../widgets/icons/close'
import Button from '../../widgets/buttons/button'
import octoClient from '../../octoClient'
import mutator from '../../mutator'
import {getTemplates, getCurrentBoardId} from '../../store/boards'
import {getCurrentTeam, Team} from '../../store/teams'
import {fetchGlobalTemplates, getGlobalTemplates} from '../../store/globalTemplates'
import {useAppDispatch, useAppSelector} from '../../store/hooks'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'

import './boardTemplateSelector.scss'
import {OnboardingBoardTitle} from '../cardDetail/cardDetail'
import {IUser, UserConfigPatch} from '../../user'
import {getMe, patchProps} from '../../store/users'
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
    const globalTemplates = useAppSelector<Board[]>(getGlobalTemplates) || []
    const currentBoardId = useAppSelector<string>(getCurrentBoardId) || null
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)
    const {title, description, onClose} = props
    const dispatch = useAppDispatch()
    const intl = useIntl()
    const history = useHistory()
    const match = useRouteMatch<{boardId: string, viewId?: string}>()
    const me = useAppSelector<IUser|null>(getMe)

    useHotkeys('esc', () => props.onClose?.())

    const showBoard = async (boardId: string | null) => {
        if (!boardId) {
            return
        }
        Utils.showBoard(boardId, match, history)
        if (onClose) {
            onClose()
        }
    }

    useEffect(() => {
        if (octoClient.teamId !== Constants.globalTeamId && globalTemplates.length === 0) {
            dispatch(fetchGlobalTemplates())
        }
    }, [octoClient.teamId])

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
    const templates = Object.values(unsortedTemplates).sort((a: Board, b: Board) => a.createAt - b.createAt)
    const allTemplates = globalTemplates.concat(templates).filter((template) => template.title === VISIBLE_TEMPLATE_TITLE)

    const resetTour = async () => {
        TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.StartTour)

        if (!me) {
            return
        }

        const patch: UserConfigPatch = {
            updatedFields: {
                onboardingTourStarted: '1',
                onboardingTourStep: BaseTourSteps.OPEN_A_CARD.toString(),
                tourCategory: TOUR_BASE,
            },
        }

        const patchedProps = await octoClient.patchUserConfig(me.id, patch)
        if (patchedProps) {
            await dispatch(patchProps(patchedProps))
        }
    }

    const handleUseTemplate = async () => {
        if (activeTemplate.teamId === '0') {
            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.CreateBoardViaTemplate, {boardTemplateId: activeTemplate.properties.trackingTemplateId as string, channelID: props.channelId})
        }

        const boardsAndBlocks = await mutator.addBoardFromTemplate(currentTeam?.id || Constants.globalTeamId, intl, showBoard, () => showBoard(currentBoardId), activeTemplate.id, currentTeam?.id)
        const board = boardsAndBlocks.boards[0]
        await mutator.updateBoard({...board, channelId: props.channelId || ''}, board, 'linked channel')
        if (activeTemplate.title === OnboardingBoardTitle) {
            resetTour()
        }
    }

    const [activeTemplate, setActiveTemplate] = useState<Board>(allTemplates[0])

    useEffect(() => {
        if (!activeTemplate) {
            setActiveTemplate(allTemplates[0])
        }
    }, [templates, globalTemplates])

    if (!allTemplates) {
        return <div/>
    }

    return (
        <div class={`BoardTemplateSelector__container ${onClose ? '' : 'BoardTemplateSelector__container--page'}`}>
            {onClose &&
                <div
                    onClick={onClose}
                    class='BoardTemplateSelector__backdrop'
                />}
            <div class='BoardTemplateSelector'>
                <div class='toolbar'>
                    {onClose &&
                        <IconButton
                            size='medium'
                            onClick={onClose}
                            icon={<CloseIcon/>}
                            title={'Close'}
                        />}
                </div>
                <div class='header'>
                    <h1 class='title'>
                        {title || (
                            <FormattedMessage
                                id='BoardTemplateSelector.title'
                                defaultMessage='Create a board'
                            />
                        )}
                    </h1>
                    <p class='description'>
                        {description || (
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
                                onClick={() => mutator.addEmptyBoardTemplate(currentTeam?.id || '', intl, showBoard, () => showBoard(currentBoardId))}
                            >
                                <FormattedMessage
                                    id='BoardTemplateSelector.add-template'
                                    defaultMessage='Create new template'
                                />
                            </Button>
                            {allTemplates.map((boardTemplate) => (
                                <BoardTemplateSelectorItem
                                    isActive={activeTemplate?.id === boardTemplate.id}
                                    template={boardTemplate}
                                    onSelect={setActiveTemplate}
                                    onDelete={onBoardTemplateDelete}
                                    onEdit={showBoard}
                                />
                            ))}
                        </div>
                        <div class='templates-sidebar__footer'>
                            <Button
                                emphasis='secondary'
                                size={'medium'}
                                icon={<CompassIcon icon='kanban'/>}
                                onClick={async () => {
                                    const boardsAndBlocks = await mutator.addEmptyBoard(currentTeam?.id || '', intl, showBoard, () => showBoard(currentBoardId))
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
                            <BoardTemplateSelectorPreview activeTemplate={activeTemplate}/>
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
    )
}

export default BoardTemplateSelector
