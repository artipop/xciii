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
import AutomationDialog, {isAutomationAvailable} from '../acp/automationDialog'
import SourcesDialog, {isSourcesAvailable} from '../acp/sourcesDialog'
import TemplateEditor from '../acp/templateEditor'
import {isSaveAsTemplateAvailable, saveBoardAsTemplate} from '../acp/saveAsTemplate'

// What this menu holds is what is true of *this board*, and only that. The
// registries it used to open — agents, where to deploy, how to reach the
// network — belong to the machine and are in the sidebar's settings, where they
// can be reached with no board open at all. Talking a task over with an agent
// is a way of making cards and lives on the "New" button. Setting the board up
// is offered by the board's own title while it is unanswered, and by the screen
// below afterwards.

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
                        <Show when={isAutomationAvailable()}>
                            <Menu.Text
                                id='workflows'
                                name={intl.formatMessage({id: 'ViewHeader.automation', defaultMessage: 'How this board works…'})}
                                onClick={() => setShowWorkflows(true)}
                            />
                        </Show>

                        {/* Sources stay in this menu while the registries left
                            it: what feeds a board is true of *that board* — a
                            source belongs to the board it was made on and is
                            offered nowhere else — where an agent or a deploy
                            target belongs to the machine. */}
                        <Show when={isSourcesAvailable()}>
                            <Menu.Text
                                id='sources'
                                name={intl.formatMessage({id: 'ViewHeader.sources', defaultMessage: 'Sources…'})}
                                onClick={() => setShowSources(true)}
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
            <Show when={showWorkflows()}>
                <AutomationDialog
                    board={props.board}
                    onClose={() => setShowWorkflows(false)}
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
