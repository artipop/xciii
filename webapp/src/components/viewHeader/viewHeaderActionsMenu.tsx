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
import {useAppSelector} from '../../store/hooks'
import {getCurrentBoardViews} from '../../store/views'

import ModalWrapper from '../modalWrapper'
import {sendFlashMessage} from '../flashMessages'
import AutomationDialog, {isAutomationAvailable} from '../acp/automationDialog'
import WorkdirsDialog from '../acp/workdirsDialog'
import BoardPromptsDialog, {isBoardPromptsAvailable} from '../acp/boardPromptsDialog'
import DeployTargetsDialog from '../acp/deployTargetsDialog'
import BoardSetupWizard from '../acp/boardSetupWizard'
import {createSetupPlan, isBoardSetupAvailable} from '../acp/boardSetup'
import SourcesDialog, {isSourcesAvailable} from '../acp/sourcesDialog'
import TemplateEditor from '../acp/templateEditor'
import {isSaveAsTemplateAvailable, saveBoardAsTemplate} from '../acp/saveAsTemplate'
import {isInboxView} from '../acp/inboxView'

// What this menu holds is what is true of *this board*, and only that. The
// registries it used to open — agents, where to deploy, how to reach the
// network — belong to the machine and are in the sidebar's settings, where they
// can be reached with no board open at all. Talking a task over with an agent
// is a way of making cards and lives on the "New" button. Setting the board up
// is offered by the board's own title while it is unanswered, and by the screen
// below afterwards.
//
// And what is true of *this view* is the rest of the sorting. «Входящие» is the
// one view about where cards come from, so it is the one that offers
// «Источники…» — and offers nothing else: exporting the inbox, saving it as a
// template or editing the board's routes are questions about the board, asked
// from the screen the board is on. Everywhere else the menu is the board's, and
// sources are not in it: hunting for the setting that feeds the inbox anywhere
// but on the inbox is what this fixes.
//
// With one door left open. A board made empty has no «Входящие» — the view
// arrives with the first source, and a board nothing arrives on is not given
// one — so on a board that has none the sources stay in the board's own menu.
// Otherwise the only way to make an inbox would be through a screen that only
// exists once you have.

// «Сохранить как шаблон…» is parked rather than deleted, and this is the one
// line that parks it. A board set up the way somebody wants it is still the
// best template there is, and everything behind the door — saveAsTemplate.ts,
// templateEditor.tsx, their tests — is untouched and still reached by the
// pencil in the template picker. What it has not got is a reason to stand in
// the menu of every board: making a template is a rare and deliberate act, and
// here it sat one slot away from the things a board is set up with. Flip it
// back to open the door.
const OFFER_SAVE_AS_TEMPLATE = false

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
    const [showWorkflows, setShowWorkflows] = createSignal(false)
    const [showSources, setShowSources] = createSignal(false)
    const [showWorkdirs, setShowWorkdirs] = createSignal(false)
    const [showDeploys, setShowDeploys] = createSignal(false)
    const [showPrompts, setShowPrompts] = createSignal(false)
    const [showSetup, setShowSetup] = createSignal(false)

    // Which of the setup questions this board asks is the board's own answer,
    // and the menu follows it: a board of shopping lists is offered folders and
    // nothing else, a board that deploys is offered somewhere to deploy to.
    // They were folds of «Колонки и маршруты…», where setting up where an
    // agent works was a question about columns and routes — which it is not —
    // and a fold under a canvas is a place nobody opens.
    const [plan, refreshPlan] = createSetupPlan(() => props.board)
    const asks = (kind: string) => (plan()?.steps || []).some((s) => s.kind === kind)

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

    const views = useAppSelector(getCurrentBoardViews)
    const onInbox = () => isInboxView(props.activeView)
    const offerSources = () => isSourcesAvailable() && (onInbox() || !views().some(isInboxView))

    return (
        <ModalWrapper>
            {/* On the inbox with no sources to offer, the menu would be an empty
                one: a button that opens nothing is worse than no button. */}
            <Show when={!onInbox() || offerSources()}>
                <MenuWrapper
                    label={intl.formatMessage({id: 'ViewHeader.view-header-menu', defaultMessage: 'View header menu'})}
                    menu={
                        <Menu position='left'>
                            <Show when={!onInbox()}>
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
                                <Show when={isAutomationAvailable()}>
                                    <Menu.Text
                                        id='workflows'
                                        name={intl.formatMessage({id: 'ViewHeader.automation', defaultMessage: 'Columns and routes…'})}
                                        onClick={() => setShowWorkflows(true)}
                                    />
                                </Show>

                                {/* What the board's agents are told first. Its
                                    own item for the same reason the folders
                                    have one: it was a fold at the bottom of the
                                    route canvas, and a fold under a canvas is
                                    somewhere nobody scrolls to. Offered where
                                    the board is one agents work on. */}
                                <Show when={isBoardPromptsAvailable() && asks('agent')}>
                                    <Menu.Text
                                        id='boardPrompts'
                                        name={intl.formatMessage({id: 'ViewHeader.board-prompts', defaultMessage: 'The board’s system prompt…'})}
                                        onClick={() => setShowPrompts(true)}
                                    />
                                </Show>

                                <Show when={asks('project')}>
                                    <Menu.Text
                                        id='workdirs'
                                        name={intl.formatMessage({id: 'ViewHeader.workdirs', defaultMessage: 'Folders…'})}
                                        onClick={() => setShowWorkdirs(true)}
                                    />
                                </Show>

                                <Show when={asks('deploy')}>
                                    <Menu.Text
                                        id='deploys'
                                        name={intl.formatMessage({id: 'ViewHeader.deploys', defaultMessage: 'Where to deploy…'})}
                                        onClick={() => setShowDeploys(true)}
                                    />
                                </Show>

                                <Show when={isBoardSetupAvailable() && (plan()?.steps.length || 0) > 0}>
                                    <Menu.Text
                                        id='setup'
                                        name={intl.formatMessage({id: 'ViewHeader.setup', defaultMessage: 'Walk the setup again…'})}
                                        onClick={() => setShowSetup(true)}
                                    />
                                </Show>

                                <Show when={OFFER_SAVE_AS_TEMPLATE && isSaveAsTemplateAvailable() && !props.board.isTemplate}>
                                    <Menu.Text
                                        id='saveAsTemplate'
                                        name={intl.formatMessage({id: 'ViewHeader.save-as-template', defaultMessage: 'Save as a template…'})}
                                        onClick={saveAsTemplate}
                                    />
                                </Show>
                            </Show>

                            <Show when={offerSources()}>
                                <Menu.Text
                                    id='sources'
                                    name={intl.formatMessage({id: 'ViewHeader.sources', defaultMessage: 'Sources…'})}
                                    onClick={() => setShowSources(true)}
                                />
                            </Show>
                        </Menu>
                    }
                >
                    <IconButton icon={<OptionsIcon/>}/>
                </MenuWrapper>
            </Show>
            <Show when={showWorkflows()}>
                <AutomationDialog
                    board={props.board}
                    onClose={() => setShowWorkflows(false)}
                />
            </Show>
            <Show when={showWorkdirs()}>
                <WorkdirsDialog
                    board={props.board}
                    onClose={() => {
                        setShowWorkdirs(false)
                        refreshPlan()
                    }}
                />
            </Show>
            <Show when={showPrompts()}>
                <BoardPromptsDialog
                    board={props.board}
                    onClose={() => setShowPrompts(false)}
                />
            </Show>
            <Show when={showDeploys()}>
                <DeployTargetsDialog
                    board={props.board}
                    onChange={refreshPlan}
                    onClose={() => setShowDeploys(false)}
                />
            </Show>
            <Show when={showSetup()}>
                <BoardSetupWizard
                    board={props.board}
                    onClose={() => {
                        setShowSetup(false)
                        refreshPlan()
                    }}
                />
            </Show>
            <Show when={showSources()}>
                <SourcesDialog
                    board={props.board}
                    onClose={() => setShowSources(false)}
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
