// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {CsvExporter} from '../../csvExporter'
import {Archiver} from '../../archiver'
import {Board} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import IconButton from '../../widgets/buttons/iconButton'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import {Utils} from '../../utils'

import ModalWrapper from '../modalWrapper'
import {sendFlashMessage} from '../flashMessages'
import AgentProjectsDialog, {isAgentProjectsAvailable} from '../acp/agentProjectsDialog'
import AgentsDialog, {isAgentsAvailable} from '../acp/agentsDialog'
import DeployTargetsDialog, {isDeployTargetsAvailable} from '../acp/deployTargetsDialog'
import AutomationDialog, {isAutomationAvailable} from '../acp/automationDialog'
import TemplateEditor from '../acp/templateEditor'
import {isSaveAsTemplateAvailable, saveBoardAsTemplate} from '../acp/saveAsTemplate'
import PlanningDialog, {isPlanningAvailable} from '../acp/planningDialog'
import BoardSetupWizard from '../acp/boardSetupWizard'
import {createSetupPlan, isBoardSetupAvailable, planHasStep} from '../acp/boardSetup'

type Props = {
    board: Board
    activeView: BoardView
    cards: Card[]
}

function onExportCsvTrigger(board: Board, activeView: BoardView, cards: Card[], intl: IntlShape) {
    try {
        CsvExporter.exportTableCsv(board, activeView, cards, intl)
        const exportCompleteMessage = intl.formatMessage({
            id: 'ViewHeader.export-complete',
            defaultMessage: 'Export complete!',
        })
        sendFlashMessage({content: exportCompleteMessage, severity: 'normal'})
    } catch (e) {
        Utils.logError(`ExportCSV ERROR: ${e}`)
        const exportFailedMessage = intl.formatMessage({
            id: 'ViewHeader.export-failed',
            defaultMessage: 'Export failed!',
        })
        sendFlashMessage({content: exportFailedMessage, severity: 'high'})
    }
}

const ViewHeaderActionsMenu = (props: Props) => {
    const intl = useIntl()
    const [plan] = createSetupPlan(() => props.board)
    const [showAgentRepos, setShowAgentRepos] = createSignal(false)
    const [showAgents, setShowAgents] = createSignal(false)
    const [showDeployTargets, setShowDeployTargets] = createSignal(false)
    const [showWorkflows, setShowWorkflows] = createSignal(false)
    const [showPlanning, setShowPlanning] = createSignal(false)
    const [showSetup, setShowSetup] = createSignal(false)

    // The template a board was saved as, held so the editor opens on it: it is
    // a board of its own and the page has not navigated to it.
    const [template, setTemplate] = createSignal<Board | null>(null)

    const saveAsTemplate = async () => {
        try {
            setTemplate(await saveBoardAsTemplate(props.board, intl))
        } catch (e) {
            sendFlashMessage({content: String(e), severity: 'high'})
        }
    }

    return (
        <ModalWrapper>
            <MenuWrapper
                label={intl.formatMessage({id: 'ViewHeader.view-header-menu', defaultMessage: 'View header menu'})}
                menu={
                    <Menu position='left'>
                        <Menu.Text
                            id='exportCsv'
                            name={intl.formatMessage({id: 'ViewHeader.export-csv', defaultMessage: 'Export to CSV'})}
                            onClick={() => onExportCsvTrigger(props.board, props.activeView, props.cards, intl)}
                        />
                        <Menu.Text
                            id='exportBoardArchive'
                            name={intl.formatMessage({id: 'ViewHeader.export-board-archive', defaultMessage: 'Export board archive'})}
                            onClick={() => Archiver.exportBoardArchive(props.board)}
                        />
                        <Show when={isPlanningAvailable()}>
                            <Menu.Text
                                id='planTask'
                                name={intl.formatMessage({id: 'ViewHeader.plan-task', defaultMessage: 'Plan a task…'})}
                                onClick={() => setShowPlanning(true)}
                            />
                        </Show>
                        {/* A board with nothing to answer is not offered a
                            walk through nothing — a template, or a board that
                            runs no automation at all. */}
                        <Show when={isBoardSetupAvailable() && plan().steps.length > 0}>
                            <Menu.Text
                                id='boardSetup'
                                name={intl.formatMessage({id: 'ViewHeader.board-setup', defaultMessage: 'Set up this board…'})}
                                onClick={() => setShowSetup(true)}
                            />
                        </Show>
                        <Show when={isAgentProjectsAvailable()}>
                            <Menu.Text
                                id='agentRepos'
                                name={intl.formatMessage({id: 'ViewHeader.agent-projects', defaultMessage: 'Projects…'})}
                                onClick={() => setShowAgentRepos(true)}
                            />
                        </Show>
                        <Show when={isAgentsAvailable()}>
                            <Menu.Text
                                id='agents'
                                name={intl.formatMessage({id: 'ViewHeader.agents', defaultMessage: 'Agents…'})}
                                onClick={() => setShowAgents(true)}
                            />
                        </Show>

                        {/* The registries are per machine, but the questions
                            are per board, and the board's own setup plan is
                            where that is decided — one answer, the same one the
                            wizard walks. */}
                        <Show when={isDeployTargetsAvailable() && planHasStep(plan(), 'deploy')}>
                            <Menu.Text
                                id='deployTargets'
                                name={intl.formatMessage({id: 'ViewHeader.deploy-targets', defaultMessage: 'Deploy targets…'})}
                                onClick={() => setShowDeployTargets(true)}
                            />
                        </Show>
                        <Show when={isAutomationAvailable()}>
                            <Menu.Text
                                id='workflows'
                                name={intl.formatMessage({id: 'ViewHeader.automation', defaultMessage: 'How this board works…'})}
                                onClick={() => setShowWorkflows(true)}
                            />
                        </Show>

                        {/* A board that has been set up the way somebody wants
                            it is the best template there is, and until now the
                            only way to make one was to build it twice. */}
                        <Show when={isSaveAsTemplateAvailable() && !props.board.isTemplate}>
                            <Menu.Text
                                id='saveAsTemplate'
                                name={intl.formatMessage({id: 'ViewHeader.save-as-template', defaultMessage: 'Save as a template…'})}
                                onClick={saveAsTemplate}
                            />
                        </Show>
                    </Menu>
                }
            >
                <IconButton icon={<OptionsIcon/>}/>
            </MenuWrapper>
            <Show when={showAgentRepos()}>
                <AgentProjectsDialog
                    board={props.board}
                    onClose={() => setShowAgentRepos(false)}
                />
            </Show>
            <Show when={showAgents()}>
                <AgentsDialog
                    board={props.board}
                    onClose={() => setShowAgents(false)}
                />
            </Show>
            <Show when={showDeployTargets()}>
                <DeployTargetsDialog
                    onClose={() => setShowDeployTargets(false)}
                />
            </Show>
            <Show when={showWorkflows()}>
                <AutomationDialog
                    board={props.board}
                    onClose={() => setShowWorkflows(false)}
                />
            </Show>
            <Show when={showSetup()}>
                <BoardSetupWizard
                    board={props.board}
                    onClose={() => setShowSetup(false)}
                />
            </Show>
            <Show when={showPlanning()}>
                <PlanningDialog
                    board={props.board}
                    onClose={() => setShowPlanning(false)}
                />
            </Show>
            <Show when={template()}>
                {(saved) => (
                    <TemplateEditor
                        board={saved()}
                        onClose={() => setTemplate(null)}
                    />
                )}
            </Show>
        </ModalWrapper>
    )
}

export default ViewHeaderActionsMenu
