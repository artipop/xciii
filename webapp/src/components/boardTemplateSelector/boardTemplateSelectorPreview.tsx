import {Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup} from 'solid-js'

import {Board} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {BoardView} from '../../blocks/boardView'
import octoClient from '../../octoClient'
import {getVisibleAndHiddenGroups} from '../../boardUtils'
import {oldestView} from '../../store/views'

import ViewHeader from '../viewHeader/viewHeader'
import ViewTitle from '../viewTitle'
import Kanban from '../kanban/kanban'
import Table from '../table/table'
import CalendarFullView from '../calendar/fullCalendar'
import Gallery from '../gallery/gallery'

import './boardTemplateSelectorPreview.scss'

type Props = {
    activeTemplate: Board|null
}

const BoardTemplateSelectorPreview = (props: Props) => {
    const [activeView, setActiveView] = createSignal<BoardView|null>(null)
    const [activeTemplateCards, setActiveTemplateCards] = createSignal<Card[]>([])

    createEffect(() => {
        const activeTemplate = props.activeTemplate
        let isSubscribed = true
        if (activeTemplate) {
            setActiveTemplateCards([])
            setActiveView(null)
            octoClient.getAllBlocks(activeTemplate.id).then((blocks) => {
                if (isSubscribed) {
                    const cards = blocks.filter((b) => b.type === 'card')

                    // The view the template was made with, which is the one a
                    // board made from it opens on — not the one whose title
                    // sorts first. Every template carries «Входящие» as well
                    // now, and it sorts before «Дела», «Задачи» and «Списки»,
                    // so the preview of every template was an empty inbox and
                    // said nothing about the template.
                    const views = blocks.filter((b) => b.type === 'view') as BoardView[]
                    if (views.length > 0) {
                        setActiveView(oldestView(views))
                    }
                    if (cards.length > 0) {
                        setActiveTemplateCards(cards as Card[])
                    }
                }
            })
        }
        onCleanup(() => {
            isSubscribed = false
        })
    })

    const dateDisplayProperty = createMemo(() => {
        return props.activeTemplate?.cardProperties.find((o) => o.id === activeView()?.fields.dateDisplayPropertyId)
    })

    const groupByProperty = createMemo(() => {
        return props.activeTemplate?.cardProperties.find((o) => o.id === activeView()?.fields.groupById) || props.activeTemplate?.cardProperties[0]
    })

    const groups = createMemo(() => {
        const view = activeView()
        if (!view) {
            return {visible: [], hidden: []}
        }
        return getVisibleAndHiddenGroups(activeTemplateCards(), view.fields.visibleOptionIds, view.fields.hiddenOptionIds, groupByProperty())
    })

    return (
        <Show when={props.activeTemplate}>
            <div class='BoardTemplateSelectorPreview'>
                <Show when={activeView()}>
                    <div class='top-head'>
                        <ViewTitle
                            board={props.activeTemplate!}
                            readonly={true}
                        />
                        <ViewHeader
                            board={props.activeTemplate!}
                            activeView={activeView()!}
                            cards={activeTemplateCards()}
                            views={[activeView()!]}
                            groupByProperty={groupByProperty()}
                            addCard={() => null}
                            addCardFromTemplate={() => null}
                            addCardTemplate={() => null}
                            editCardTemplate={() => null}
                            readonly={false}
                        />
                    </div>
                </Show>

                <Switch>
                    <Match when={activeView()?.fields.viewType === 'board'}>
                        <Kanban
                            board={props.activeTemplate!}
                            activeView={activeView()!}
                            cards={activeTemplateCards()}
                            groupByProperty={groupByProperty()}
                            visibleGroups={groups().visible}
                            hiddenGroups={groups().hidden}
                            selectedCardIds={[]}
                            readonly={false}
                            onCardClicked={() => null}
                            addCard={() => Promise.resolve()}
                            addCardFromTemplate={() => Promise.resolve()}
                            showCard={() => null}
                            hiddenCardsCount={0}
                            showHiddenCardCountNotification={() => null}
                        />
                    </Match>
                    <Match when={activeView()?.fields.viewType === 'table'}>
                        <Table
                            board={props.activeTemplate!}
                            activeView={activeView()!}
                            cards={activeTemplateCards()}
                            groupByProperty={groupByProperty()}
                            views={[activeView()!]}
                            visibleGroups={groups().visible}
                            selectedCardIds={[]}
                            readonly={false}
                            cardIdToFocusOnRender={''}
                            onCardClicked={() => null}
                            addCard={() => Promise.resolve()}
                            showCard={() => null}
                            hiddenCardsCount={0}
                            showHiddenCardCountNotification={() => null}
                        />
                    </Match>
                    <Match when={activeView()?.fields.viewType === 'gallery'}>
                        <Gallery
                            board={props.activeTemplate!}
                            cards={activeTemplateCards()}
                            activeView={activeView()!}
                            readonly={false}
                            selectedCardIds={[]}
                            onCardClicked={() => null}
                            addCard={() => Promise.resolve()}
                            hiddenCardsCount={0}
                            showHiddenCardCountNotification={() => null}
                        />
                    </Match>
                    <Match when={activeView()?.fields.viewType === 'calendar'}>
                        <CalendarFullView
                            board={props.activeTemplate!}
                            cards={activeTemplateCards()}
                            activeView={activeView()!}
                            readonly={false}
                            dateDisplayProperty={dateDisplayProperty()}
                            showCard={() => null}
                            addCard={() => Promise.resolve()}
                        />
                    </Match>
                </Switch>
            </div>
        </Show>
    )
}

export default BoardTemplateSelectorPreview
