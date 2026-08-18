import {Match, Show, Switch, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {useNavigate} from '@solidjs/router'

import {FormattedMessage} from '../intl'

import {DatePropertyType} from '../properties/types'

import {getCurrentBoard, isLoadingBoard} from '../store/boards'
import {getCurrentViewCardsSortedFilteredAndGrouped} from '../store/cards'
import {
    getCurrentBoardViews,
    getCurrentViewGroupBy,
    getCurrentViewId,
    getCurrentViewDisplayBy,
    getCurrentView,
} from '../store/views'
import {useAppSelector, useAppStore} from '../store/hooks'

import {getClientConfig} from '../store/clientConfig'

import wsClient, {WSClient} from '../wsclient'
import {ClientConfig} from '../config/clientConfig'
import {Utils} from '../utils'
import {IUser} from '../user'
import propsRegistry from '../properties'
import {useRouteMatch} from '../hooks/routerMatch'

import {getMe} from '../store/users'

import {getHiddenBoardIDs} from '../store/sidebar'

import CenterPanel from './centerPanel'
import TemplateEditor from './acp/templateEditor'
import BoardTemplateSelector from './boardTemplateSelector/boardTemplateSelector'
import GuestNoBoards from './guestNoBoards'

import Sidebar from './sidebar/sidebar'

import './workspace.scss'

type Props = {
    readonly: boolean
}

function CenterContent(props: Props) {
    const isLoading = useAppSelector(isLoadingBoard)
    const match = useRouteMatch()
    const board = useAppSelector(getCurrentBoard)
    const cards = useAppSelector(getCurrentViewCardsSortedFilteredAndGrouped)
    const activeView = useAppSelector(getCurrentView)
    const views = useAppSelector(getCurrentBoardViews)
    const groupByProperty = useAppSelector(getCurrentViewGroupBy)
    const dateDisplayProperty = useAppSelector(getCurrentViewDisplayBy)
    const clientConfig = useAppSelector(getClientConfig)
    const navigate = useNavigate()
    const {actions} = useAppStore()
    const me = useAppSelector<IUser|null>(getMe)
    const hiddenBoardIDs = useAppSelector(getHiddenBoardIDs)

    const isBoardHidden = () => {
        return hiddenBoardIDs().includes(board()?.id)
    }

    const showCard = (cardId?: string) => {
        const currentMatch = match()
        const params = {...currentMatch.params, cardId}
        let newPath = Utils.generatePath(currentMatch.path, params)
        if (props.readonly) {
            newPath += `?r=${Utils.getReadToken()}`
        }
        navigate(newPath)
        actions.cards.setCurrent(cardId || '')
    }

    createEffect(() => {
        const onConfigChangeHandler = (_: WSClient, config: ClientConfig) => {
            actions.clientConfig.setClientConfig(config)
        }
        wsClient.addOnConfigChange(onConfigChangeHandler)

        onCleanup(() => {
            wsClient.removeOnConfigChange(onConfigChangeHandler)
        })
    })

    const templateSelector = () => (
        <BoardTemplateSelector
            title={
                <FormattedMessage
                    id='BoardTemplateSelector.plugin.no-content-title'
                    defaultMessage='Create a board'
                />
            }
            description={
                <FormattedMessage
                    id='BoardTemplateSelector.plugin.no-content-description'
                    defaultMessage='Add a board to the sidebar using any of the templates defined below or start from scratch.'
                />
            }
        />
    )

    const property = () => {
        let result = groupByProperty()
        if ((!result || !propsRegistry.get(result.type).canGroup) && activeView()?.fields.viewType === 'board') {
            result = board()?.cardProperties.find((o) => propsRegistry.get(o.type).canGroup)
        }
        return result
    }

    const displayProperty = () => {
        let result = dateDisplayProperty()
        if (!result && activeView()?.fields.viewType === 'calendar') {
            result = board()?.cardProperties.find((o) => propsRegistry.get(o.type) instanceof DatePropertyType)
        }
        return result
    }

    return (
        <Switch>
            <Match when={board() && !isBoardHidden() && activeView()}>
                <CenterPanel
                    clientConfig={clientConfig()}
                    readonly={props.readonly}
                    board={board()!}
                    cards={cards()}
                    shownCardId={match().params.cardId}
                    showCard={showCard}
                    activeView={activeView()!}
                    groupByProperty={property()}
                    dateDisplayProperty={displayProperty()}
                    views={views()}
                />
            </Match>
            <Match when={(board() && !isBoardHidden()) || isLoading()}>
                {null}
            </Match>
            <Match when={me()?.is_guest}>
                <GuestNoBoards/>
            </Match>
            <Match when={true}>
                {templateSelector()}
            </Match>
        </Switch>
    )
}

const Workspace = (props: Props): JSX.Element => {
    const board = useAppSelector(getCurrentBoard)

    const viewId = useAppSelector(getCurrentViewId)
    const [boardTemplateSelectorOpen, setBoardTemplateSelectorOpen] = createSignal(false)
    const [editingTemplate, setEditingTemplate] = createSignal(false)

    const closeBoardTemplateSelector = () => {
        setBoardTemplateSelectorOpen(false)
    }
    const openBoardTemplateSelector = () => {
        if (board()) {
            setBoardTemplateSelectorOpen(true)
        }
    }
    createEffect(() => {
        board()
        viewId()
        setBoardTemplateSelectorOpen(false)
    })

    return (
        <div class='Workspace'>
            <Show when={!props.readonly}>
                <Sidebar
                    onBoardTemplateSelectorOpen={openBoardTemplateSelector}
                    onBoardTemplateSelectorClose={closeBoardTemplateSelector}
                    activeBoardId={board()?.id}
                />
            </Show>
            <div class='mainFrame'>
                <Show when={boardTemplateSelectorOpen()}>
                    <BoardTemplateSelector onClose={closeBoardTemplateSelector}/>
                </Show>
                <Show when={board()?.isTemplate}>
                    <div class='banner'>
                        <FormattedMessage
                            id='Workspace.editing-board-template'
                            defaultMessage="You're editing a board template."
                        />

                        {/* The board shows the cards and the columns; what a
                            template is actually for — what runs in a column,
                            where a card goes next, what the board will ask for
                            — is not on the board at all, so the way to it has
                            to be here. */}
                        <button
                            class='banner__action'
                            onClick={() => setEditingTemplate(true)}
                        >
                            <FormattedMessage
                                id='Workspace.edit-template-settings'
                                defaultMessage='Columns, routes and setup…'
                            />
                        </button>
                    </div>
                    <Show when={editingTemplate() && board()}>
                        <TemplateEditor
                            board={board()!}
                            onClose={() => setEditingTemplate(false)}
                        />
                    </Show>
                </Show>
                <CenterContent
                    readonly={props.readonly}
                />
            </div>
        </div>
    )
}

export default Workspace
