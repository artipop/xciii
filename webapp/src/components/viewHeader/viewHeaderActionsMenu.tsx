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
import WorkflowsDialog, {isWorkflowsAvailable} from '../acp/workflowsDialog'
import PlanningDialog, {isPlanningAvailable} from '../acp/planningDialog'
import BoardSetupWizard, {isBoardSetupAvailable} from '../acp/boardSetupWizard'

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
    const [showAgentRepos, setShowAgentRepos] = createSignal(false)
    const [showAgents, setShowAgents] = createSignal(false)
    const [showDeployTargets, setShowDeployTargets] = createSignal(false)
    const [showWorkflows, setShowWorkflows] = createSignal(false)
    const [showPlanning, setShowPlanning] = createSignal(false)
    const [showSetup, setShowSetup] = createSignal(false)

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
                        <Show when={isBoardSetupAvailable()}>
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
                        <Show when={isDeployTargetsAvailable()}>
                            <Menu.Text
                                id='deployTargets'
                                name={intl.formatMessage({id: 'ViewHeader.deploy-targets', defaultMessage: 'Deploy targets…'})}
                                onClick={() => setShowDeployTargets(true)}
                            />
                        </Show>
                        <Show when={isWorkflowsAvailable()}>
                            <Menu.Text
                                id='workflows'
                                name={intl.formatMessage({id: 'ViewHeader.workflows', defaultMessage: 'Workflows…'})}
                                onClick={() => setShowWorkflows(true)}
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
                <WorkflowsDialog
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
                    onClose={() => setShowPlanning(false)}
                />
            </Show>
        </ModalWrapper>
    )
}

export default ViewHeaderActionsMenu
