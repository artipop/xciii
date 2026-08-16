import {For, Show, createEffect, createMemo, createSignal, onMount} from 'solid-js'
import type {JSX} from 'solid-js'

import {useNavigate} from '@solidjs/router'

import {FormattedMessage, useIntl} from '../../intl'

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

import TemplateEditor from '../acp/templateEditor'

import BoardTemplateSelectorPreview from './boardTemplateSelectorPreview'
import BoardTemplateSelectorItem from './boardTemplateSelectorItem'

type Props = {
    title?: JSX.Element
    description?: JSX.Element
    onClose?: () => void
    channelId?: string
}

// Of the templates that come with the install, only these are offered: the rest
// of the upstream defaults and the onboarding board are hidden. Each of ours
// ships its own columns and routes in the board's own properties, which is what
// makes a board from it run without any setup — an upstream template would land
// here as a board the automation knows nothing about.
//
// A template the user made is a different matter and is always offered,
// whatever it carries: it is theirs, they can see what is in it, and hiding it
// is how "Create new template" used to lead nowhere at all.
//
// They are named by the marker each one carries rather than by its title. The
// title is Russian prose somebody may reword, and a filter keyed on it would
// then quietly offer nothing; the marker is what the Go side already recognises
// a board by (`TemplateMarkerProperty` in `internal/boardadapter/templates.go`),
// and it is the file name in `internal/boardadapter/templates`.
//
// The list names every edition's templates, the paid one's included, and the
// page is none the wiser about which build serves it: the extra boards are
// simply not in a base binary, so their slugs match nothing and the filter
// drops them. Which is the point of deciding an edition at compile time — a
// page that knew would be a page that could be told otherwise.
const TEMPLATE_MARKER = 'xciiiTemplate'
const VISIBLE_TEMPLATE_SLUGS = [
    'developer-tasks',
    'content-making',
    'home-chores',
    'research',
    'documentation',
]

// templateSlug is the marker, or '' for a board that carries none — every
// template but ours.
function templateSlug(template: Board): string {
    const marker = template.properties?.[TEMPLATE_MARKER]
    return typeof marker === 'string' ? marker : ''
}

// The id the importer files its own templates under. A person's board is
// created by them, so this is what tells the install's templates from theirs.
const SYSTEM_USER = 'system'

// shipped says the install put this template there rather than a person.
//
// It used to read the version stamp, and that is a thing a template can
// *inherit*: a board made from one carries its version, and a template saved
// from that board carried it too — so somebody's own copy counted as shipped
// and was hidden from the list it belongs to. The team does not tell them
// apart either (here everything is in the same team), and neither does
// `trackingTemplateId`, which "New template" stamps on the user's own as
// readily as on the built-ins. Who made it does.
function shipped(template: Board): boolean {
    return template.createdBy === SYSTEM_USER
}

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

    // Both sources into one pool, because which of them a template arrives in
    // says nothing about the template — only about how the app is running. In
    // this app the board's team *is* the global team, so the install's own
    // templates come down with the board list and the fetch above never runs;
    // under Mattermost they arrive only through that fetch. Reading one source
    // is how the selector came to offer nothing at all here.
    const pool = createMemo(() => {
        const byId = new Map<string, Board>()
        for (const template of [...(globalTemplates() || []), ...Object.values(unsortedTemplates())]) {
            byId.set(template.id, template)
        }
        return [...byId.values()]
    })

    const allTemplates = createMemo(() => {
        // The archive hands ours over in whatever order it was packed in, so
        // the list above is also the order they are offered in — and its first
        // entry is what the selector opens on.
        const ours = pool().
            filter((template) => VISIBLE_TEMPLATE_SLUGS.includes(templateSlug(template))).
            sort((a: Board, b: Board) =>
                VISIBLE_TEMPLATE_SLUGS.indexOf(templateSlug(a)) - VISIBLE_TEMPLATE_SLUGS.indexOf(templateSlug(b)))
        const taken = new Set(ours.map((template) => template.id))

        // Then the user's own, oldest first — a list that grows downwards is
        // one where a template stays where it was put. What tells one from a
        // template the install shipped is `shipped` below; the team does not,
        // because here everything is in the same team.
        // …minus whatever the first list already took. A copy of a board made
        // from one of ours carries its marker until the next launch takes it
        // off (disownTemplate), and for that while it answers both questions:
        // ours by the marker, theirs by who made it. Two rows for one board is
        // a worse answer than either.
        const mine = pool().
            filter((template: Board) => !shipped(template) && !taken.has(template.id)).
            sort((a: Board, b: Board) => a.createAt - b.createAt)
        return [...ours, ...mine]
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

    // The pencil used to open the template as a board, which shows its cards
    // and hides everything a template is chosen for. It opens the template
    // itself now.
    const [editing, setEditing] = createSignal<Board | null>(null)

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
                <Show when={editing()}>
                    {(template) => (
                        <TemplateEditor
                            board={template()}
                            onClose={() => setEditing(null)}
                        />
                    )}
                </Show>
                <div class='BoardTemplateSelector'>
                    <div class='toolbar'>
                        <Show when={props.onClose}>
                            <IconButton
                                size='medium'
                                onClick={props.onClose}
                                icon={<CloseIcon/>}
                                title={intl.formatMessage({id: 'Modal.close', defaultMessage: 'Close'})}
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
                                    class='new-template'
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
                                            onEdit={setEditing}
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
