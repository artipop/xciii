// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import moment from 'moment'

import {useIntl} from '../../intl'

import mutator from '../../mutator'

import Editable from '../../widgets/editable'
import Button from '../../widgets/buttons/button'
import Calendar from '../../widgets/calendar'
import {BoardView} from '../../blocks/boardView'

import Modal from '../../components/modal'
import ModalWrapper from '../../components/modalWrapper'
import {Utils} from '../../utils'
import useMomentLocale from '../../hooks/momentLocale'
import {isDate, parseLocalizedDate} from '../../widgets/dateUtils'

import './dateFilter.scss'

import {FilterClause} from '../../blocks/filterClause'
import {createFilterGroup} from '../../blocks/filterGroup'

export type DateProperty = {
    from?: number
    to?: number
    includeTime?: boolean
    timeZone?: string
}

type Props = {
    view: BoardView
    filter: FilterClause
}

function DateFilter(props: Props): JSX.Element {
    const [showDialog, setShowDialog] = createSignal(false)

    const initialDateValue = (): Date | undefined => {
        const filterValue = props.filter.values
        if (filterValue && filterValue.length > 0) {
            return new Date(parseInt(filterValue[0], 10))
        }
        return undefined
    }

    const [value, setValue] = createSignal(initialDateValue())
    const intl = useIntl()

    const timeZoneOffset = (date: number): number => {
        return new Date(date).getTimezoneOffset() * 60 * 1000
    }

    const onChange = (newValue: Date | undefined) => {
        if (value() !== newValue) {
            const adjustedValue = newValue ? new Date(newValue.getTime() - timeZoneOffset(newValue.getTime())) : undefined
            setValue(adjustedValue)

            const {view, filter} = props
            const filterIndex = view.fields.filter.filters.indexOf(filter)
            Utils.assert(filterIndex >= 0, "Can't find filter")

            const filterGroup = createFilterGroup(view.fields.filter)
            const newFilter = filterGroup.filters[filterIndex] as FilterClause
            Utils.assert(newFilter, `No filter at index ${filterIndex}`)

            newFilter.values = []
            if (adjustedValue) {
                newFilter.values = [adjustedValue.getTime().toString()]
            }
            mutator.changeViewFilter(view.boardId, view.id, view.fields.filter, filterGroup)
        }
    }

    const getDisplayDate = (date: Date | null | undefined) => {
        let displayDate = ''
        if (date) {
            displayDate = Utils.displayDate(date, intl)
        }
        return displayDate
    }

    // Keep date value as UTC, property dates are stored as 12:00 pm UTC
    // date will need converted to local time, to ensure date stays consistent
    // dateFrom / dateTo will be used for input and calendar dates
    const offsetDate = () => {
        const current = value()
        return current ? new Date(current.getTime() + timeZoneOffset(current.getTime())) : undefined
    }
    const [input, setInput] = createSignal<string>(getDisplayDate(offsetDate()))

    const locale = () => intl.locale.toLowerCase()
    const momentRevision = useMomentLocale(locale)
    const firstDayOfWeek = () => {
        void momentRevision()
        return moment.localeData(locale()).firstDayOfWeek()
    }

    const saveValue = (newValue: Date | undefined) => {
        onChange(newValue)
        setInput(newValue ? Utils.inputDate(newValue, intl) : '')
    }

    const handleTodayClick = (day: Date) => {
        day.setHours(12)
        saveValue(day)
    }

    const handleDayClick = (day: Date) => {
        // The calendar hands over a day at midnight; the stored value is noon,
        // which is what keeps a date from sliding across a DST boundary.
        day.setHours(12)
        saveValue(day)
    }

    const onClear = () => {
        saveValue(undefined)
    }

    const onClose = () => {
        setShowDialog(false)
    }

    const displayValue = () => (offsetDate() ? getDisplayDate(offsetDate()) : '')

    const buttonText = () => displayValue() || intl.formatMessage({id: 'DateFilter.empty', defaultMessage: 'Empty'})

    const className = 'DateFilter'
    return (
        <div class={`DateFilter ${displayValue() ? '' : 'empty'} `}>
            <Button
                onClick={() => setShowDialog(true)}
            >
                {buttonText()}
            </Button>

            <Show when={showDialog()}>
                <ModalWrapper>
                    <Modal
                        onClose={() => onClose()}
                    >
                        <div
                            class={className + '-overlayWrapper'}
                        >
                            <div class={className + '-overlay'}>
                                <div class={'inputContainer'}>
                                    <Editable
                                        value={input()}
                                        placeholderText={moment.localeData(locale()).longDateFormat('L')}
                                        onFocus={() => {
                                            const date = offsetDate()
                                            if (date) {
                                                return setInput(Utils.inputDate(date, intl))
                                            }
                                            return undefined
                                        }}
                                        onChange={setInput}
                                        onSave={() => {
                                            const newDate = parseLocalizedDate(input(), intl.locale)
                                            if (newDate && isDate(newDate)) {
                                                newDate.setHours(12)
                                                saveValue(newDate)
                                            } else {
                                                setInput(getDisplayDate(offsetDate()))
                                            }
                                        }}
                                        onCancel={() => {
                                            setInput(getDisplayDate(offsetDate()))
                                        }}
                                    />
                                </div>
                                <Calendar
                                    onDayClick={handleDayClick}
                                    defaultMonth={offsetDate() || new Date()}
                                    firstDayOfWeek={firstDayOfWeek()}
                                    selection={{from: offsetDate()}}
                                    footer={
                                        <Button
                                            onClick={() => {
                                                const today = new Date()
                                                today.setHours(0, 0, 0, 0)
                                                handleTodayClick(today)
                                            }}
                                        >
                                            {intl.formatMessage({id: 'DateRange.today', defaultMessage: 'Today'})}
                                        </Button>
                                    }
                                />
                                <hr/>
                                <div
                                    class='MenuOption menu-option'
                                >
                                    <Button
                                        onClick={onClear}
                                    >
                                        {intl.formatMessage({id: 'DateRange.clear', defaultMessage: 'Clear'})}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Modal>
                </ModalWrapper>
            </Show>
        </div>
    )
}

export default DateFilter
