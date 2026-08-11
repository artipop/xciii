// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createEffect, createSignal, onCleanup, onMount} from 'solid-js'
import {render} from 'solid-js/web'
import type {JSX} from 'solid-js'

import {Calendar} from '@fullcalendar/core'
import type {EventChangeArg, EventInput, EventContentArg, DayCellContentArg, LocaleInput} from '@fullcalendar/core'

import interactionPlugin from '@fullcalendar/interaction'
import dayGridPlugin from '@fullcalendar/daygrid'

import {useIntl} from '../../intl'

import {DatePropertyType} from '../../properties/types'

import mutator from '../../mutator'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {BoardView, ICalendarSpan} from '../../blocks/boardView'
import {Card} from '../../blocks/card'
import {DateProperty} from '../../properties/date/date'
import propsRegistry from '../../properties'
import Tooltip from '../../widgets/tooltip'
import PropertyValueElement from '../propertyValueElement'
import {Constants, Permission} from '../../constants'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import CardBadges from '../cardBadges'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'

import './fullcalendar.scss'
import MenuWrapper from '../../widgets/menuWrapper'
import CardActionsMenu from '../cardActionsMenu/cardActionsMenu'
import TelemetryClient, {TelemetryActions, TelemetryCategory} from '../../telemetry/telemetryClient'
import CardActionsMenuIcon from '../cardActionsMenu/cardActionsMenuIcon'

const oneDay = 60 * 60 * 24 * 1000

type Props = {
    board: Board
    cards: Card[]
    activeView: BoardView
    readonly: boolean
    initialDate?: Date
    dateDisplayProperty?: IPropertyTemplate
    showCard: (cardId: string) => void
    addCard: (properties: Record<string, string>) => void
}

function createDatePropertyFromCalendarDates(start: Date, end: Date): DateProperty {
    // save as noon local, expected from the date picker
    start.setHours(12)
    const dateFrom = start.getTime() - timeZoneOffset(start.getTime())
    end.setHours(12)
    const dateTo = end.getTime() - timeZoneOffset(end.getTime()) - oneDay // subtract one day. Calendar is date exclusive

    const dateProperty: DateProperty = {from: dateFrom}
    if (dateTo !== dateFrom) {
        dateProperty.to = dateTo
    }
    return dateProperty
}

function createDatePropertyFromCalendarDate(start: Date): DateProperty {
    // save as noon local, expected from the date picker
    start.setHours(12)
    const dateFrom = start.getTime() - timeZoneOffset(start.getTime())

    const dateProperty: DateProperty = {from: dateFrom}
    return dateProperty
}

const timeZoneOffset = (date: number): number => {
    return new Date(date).getTimezoneOffset() * 60 * 1000
}

// FullCalendar's own core, driven directly: the React adapter existed to marry
// its imperative Calendar to React's render cycle, and Solid's fine-grained
// effects do that marriage with setOption. Custom content renders through
// solid-js/web render into the domNodes the content hooks accept, disposed in
// the matching willUnmount hooks.
const CalendarFullView = (props: Props): JSX.Element => {
    const intl = useIntl()
    const isSelectable = () => !props.readonly
    const canAddCards = useHasCurrentBoardPermissions([Permission.ManageBoardCards])
    const [showConfirmationDialogBox, setShowConfirmationDialogBox] = createSignal<boolean>(false)
    const [cardItem, setCardItem] = createSignal<Card>()

    const visiblePropertyTemplates = () => props.board.cardProperties.filter((template: IPropertyTemplate) => props.activeView.fields.visiblePropertyIds.includes(template.id))

    const initialDate = () => props.initialDate || new Date()

    const isEditable = (): boolean => {
        if (props.readonly || !props.dateDisplayProperty || propsRegistry.get(props.dateDisplayProperty.type).isReadOnly) {
            return false
        }
        return true
    }

    const myEventsList = () => props.cards.flatMap((card): EventInput[] => {
        const property = propsRegistry.get(props.dateDisplayProperty?.type || 'unknown')

        let dateFrom = new Date(card.createAt || 0)
        let dateTo = new Date(card.createAt || 0)
        if (property instanceof DatePropertyType) {
            const dateFromValue = property.getDateFrom(card.fields.properties[props.dateDisplayProperty?.id || ''], card)
            if (!dateFromValue) {
                return []
            }
            dateFrom = dateFromValue
            const dateToValue = property.getDateTo(card.fields.properties[props.dateDisplayProperty?.id || ''], card)
            dateTo = dateToValue || new Date(dateFrom)

            //full calendar end date is exclusive, so increment by 1 day.
            dateTo.setDate(dateTo.getDate() + 1)
        }
        return [{
            id: card.id,
            title: card.title,
            extendedProps: {icon: card.fields.icon},
            properties: card.fields.properties,
            allDay: true,
            start: dateFrom,
            end: dateTo,
        }]
    })

    const visibleBadges = () => props.activeView.fields.visiblePropertyIds.includes(Constants.badgesColumnId)

    const openConfirmationDialogBox = (card: Card) => {
        setShowConfirmationDialogBox(true)
        setCardItem(card)
    }

    const handleDeleteCard = () => {
        const card = cardItem()
        if (!card) {
            return
        }
        mutator.deleteBlock(card, 'delete card')
        setShowConfirmationDialogBox(false)
    }

    const confirmDialogProps: ConfirmationDialogBoxProps = {
        heading: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-heading', defaultMessage: 'Confirm card delete!'}),
        confirmButtonText: intl.formatMessage({id: 'CardDialog.delete-confirmation-dialog-button-text', defaultMessage: 'Delete'}),
        onConfirm: handleDeleteCard,
        onClose: () => {
            setShowConfirmationDialogBox(false)
        },
    }

    const EventContent = (contentProps: {event: EventContentArg['event']}): JSX.Element => {
        const card = () => props.cards.find((o) => o.id === contentProps.event.id) || props.cards[0]

        return (
            <div
                class='EventContent'
                onClick={() => props.showCard(contentProps.event.id)}
            >
                <Show when={!props.readonly}>
                    <MenuWrapper
                        class='optionsMenu'
                        stopPropagationOnToggle={true}
                        menu={
                            <CardActionsMenu
                                cardId={card().id}
                                boardId={card().boardId}
                                onClickDelete={() => openConfirmationDialogBox(card())}
                                onClickDuplicate={() => {
                                    TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.DuplicateCard, {board: props.board.id, card: card().id})
                                    mutator.duplicateCard(card().id, props.board.id)
                                }}
                            />
                        }
                    >
                        <CardActionsMenuIcon/>
                    </MenuWrapper>
                </Show>
                <div class='octo-icontitle'>
                    <Show when={contentProps.event.extendedProps.icon}>
                        <div class='octo-icon'>{contentProps.event.extendedProps.icon}</div>
                    </Show>
                    <div
                        class='fc-event-title'
                    >{contentProps.event.title || intl.formatMessage({id: 'CalendarCard.untitled', defaultMessage: 'Untitled'})}</div>
                </div>
                <For each={visiblePropertyTemplates()}>
                    {(template) => (
                        <Tooltip
                            title={template.name}
                        >
                            <PropertyValueElement
                                board={props.board}
                                readOnly={true}
                                card={card()}
                                propertyTemplate={template}
                                showEmptyPlaceholder={false}
                            />
                        </Tooltip>
                    )}
                </For>
                <Show when={visibleBadges()}>
                    <CardBadges card={card()}/>
                </Show>
            </div>
        )
    }

    const eventChange = (eventProps: EventChangeArg) => {
        const {event} = eventProps
        if (!event.start) {
            return
        }
        if (!event.end) {
            return
        }

        const startDate = new Date(event.start.getTime())
        const endDate = new Date(event.end.getTime())
        const dateProperty = createDatePropertyFromCalendarDates(startDate, endDate)
        const card = props.cards.find((o) => o.id === event.id)
        if (card && props.dateDisplayProperty) {
            mutator.changePropertyValue(props.board.id, card, props.dateDisplayProperty.id, JSON.stringify(dateProperty))
        }
    }

    const onNewEvent = (args: {start: Date, end: Date}) => {
        let dateProperty: DateProperty
        if (args.start === args.end) {
            dateProperty = createDatePropertyFromCalendarDate(args.start)
        } else {
            dateProperty = createDatePropertyFromCalendarDates(args.start, args.end)
            if (dateProperty.to === undefined) {
                return
            }
        }

        const properties: Record<string, string> = {}
        if (props.dateDisplayProperty) {
            properties[props.dateDisplayProperty.id] = JSON.stringify(dateProperty)
        }

        props.addCard(properties)
    }

    const DayCellContent = (cellProps: {date: Date, dayNumberText: string}): JSX.Element => (
        <div class={'dateContainer ' + (canAddCards() ? 'with-plus' : '')}>
            <div
                class='addEvent'
                onClick={() => onNewEvent({start: cellProps.date, end: cellProps.date})}
            >
                {'+'}
            </div>
            {/* The week view writes the date in the column header instead, so
                the cell's day number is empty there. The marker only exists to
                carry that number — drawn anyway it became a filled accent
                circle with nothing in it, one naked dot floating over today. */}
            <Show when={cellProps.dayNumberText}>
                <div class='dateDisplay'>
                    {cellProps.dayNumberText}
                </div>
            </Show>
        </div>
    )

    const toolbar = {
        left: 'title',
        center: '',
        right: 'dayGridWeek dayGridMonth prev,today,next',
    }

    const buttonText = () => ({
        today: intl.formatMessage({id: 'calendar.today', defaultMessage: 'TODAY'}),
        month: intl.formatMessage({id: 'calendar.month', defaultMessage: 'Month'}),
        week: intl.formatMessage({id: 'calendar.week', defaultMessage: 'Week'}),
    })

    // Everything FullCalendar writes itself — the month in the title, the
    // weekday headings, «ещё N», which day a week starts on — comes from a
    // locale of its own, and it ships with English alone. The definitions are
    // their own chunk, fetched only when the UI is not English, which is the
    // same bargain hooks/momentLocale.ts takes with moment's.
    const [locales, setLocales] = createSignal<LocaleInput[]>([])
    createEffect(() => {
        if (intl.locale.toLowerCase() === 'en' || locales().length > 0) {
            return
        }
        let cancelled = false
        import('@fullcalendar/core/locales-all').then((mod) => {
            if (!cancelled) {
                setLocales(mod.default)
            }
        })
        onCleanup(() => {
            cancelled = true
        })
    })

    // Named only once the definitions are here: FullCalendar warns about a
    // locale it has never been given and quietly stays English, so asking for
    // one early would cost a console warning and buy nothing.
    const calendarLocale = () => (locales().length > 0 ? intl.locale.toLowerCase() : 'en')

    let host: HTMLDivElement | undefined
    let calendar: Calendar | undefined

    // Week or month is the view's own answer, kept in the view (calendarSpan)
    // rather than in this browser: the same calendar is the same calendar on
    // the next screen and after the app is closed. Written back only when it
    // actually changes — FullCalendar reports the span on every prev/next too.
    const span = (): ICalendarSpan => props.activeView.fields.calendarSpan || 'dayGridMonth'
    const rememberSpan = (chosen: string) => {
        if ((chosen !== 'dayGridWeek' && chosen !== 'dayGridMonth') || chosen === span()) {
            return
        }
        mutator.changeViewCalendarSpan(props.board.id, props.activeView.id, chosen).catch(() => undefined)
    }

    // Every content hook renders a Solid tree into detached nodes FullCalendar
    // adopts; the matching willUnmount hook is where those trees die.
    const eventDisposers = new Map<Element, () => void>()
    const cellDisposers = new Map<Element, () => void>()

    const mountInto = (component: () => JSX.Element, registry: Map<Element, () => void>) => {
        const container = document.createElement('div')
        const dispose = render(component, container)
        registry.set(container, dispose)
        return {domNodes: [container]}
    }

    onMount(() => {
        calendar = new Calendar(host!, {
            plugins: [dayGridPlugin, interactionPlugin],
            initialView: span(),
            initialDate: initialDate(),
            dayMaxEventRows: 5,
            headerToolbar: toolbar,
            locales: locales(),
            locale: calendarLocale(),
            events: myEventsList(),
            editable: isEditable(),
            eventResizableFromStart: isEditable(),
            buttonText: buttonText(),
            selectable: isSelectable(),
            selectMirror: true,
            select: onNewEvent,
            eventChange,
            datesSet: (arg) => rememberSpan(arg.view.type),
            eventContent: (arg: EventContentArg) => mountInto(() => <EventContent event={arg.event}/>, eventDisposers),
            eventWillUnmount: (arg) => {
                for (const [node, dispose] of eventDisposers) {
                    if (arg.el.contains(node)) {
                        dispose()
                        eventDisposers.delete(node)
                    }
                }
            },
            dayCellContent: (arg: DayCellContentArg) => mountInto(() => (
                <DayCellContent
                    date={arg.date}
                    dayNumberText={arg.dayNumberText}
                />
            ), cellDisposers),
            dayCellWillUnmount: (arg) => {
                for (const [node, dispose] of cellDisposers) {
                    if (arg.el.contains(node)) {
                        dispose()
                        cellDisposers.delete(node)
                    }
                }
            },
        })
        calendar.render()

        onCleanup(() => {
            calendar?.destroy()
            eventDisposers.forEach((dispose) => dispose())
            eventDisposers.clear()
            cellDisposers.forEach((dispose) => dispose())
            cellDisposers.clear()
        })
    })

    // The options that follow the store: the event list, and what dragging is
    // allowed to do with it.
    createEffect(() => {
        if (!calendar) {
            return
        }
        calendar.setOption('events', myEventsList())
        calendar.setOption('editable', isEditable())
        calendar.setOption('eventResizableFromStart', isEditable())
        calendar.setOption('selectable', isSelectable())
        calendar.setOption('buttonText', buttonText())
        calendar.setOption('locales', locales())
        calendar.setOption('locale', calendarLocale())
    })

    // …and the span itself, when it was changed somewhere else: another window
    // on the same board, or this one coming back to a view it already had an
    // answer for.
    createEffect(() => {
        const wanted = span()
        if (calendar && calendar.view.type !== wanted) {
            calendar.changeView(wanted)
        }
    })

    return (
        <div
            class='CalendarContainer'
        >
            <div ref={host}/>
            <Show when={showConfirmationDialogBox()}>
                <ConfirmationDialogBox dialogBox={confirmDialogProps}/>
            </Show>
        </div>
    )
}

export default CalendarFullView
