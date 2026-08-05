// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createEffect, createMemo, createSignal, on} from 'solid-js'
import type {JSX} from 'solid-js'

import moment from 'moment'

import {useIntl} from '../../intl'

import mutator from '../../mutator'

import Editable from '../../widgets/editable'
import SwitchOption from '../../widgets/menu/switchOption'
import Button from '../../widgets/buttons/button'
import Calendar from '../../widgets/calendar'

import Modal from '../../components/modal'
import ModalWrapper from '../../components/modalWrapper'
import {Utils} from '../../utils'
import useMomentLocale from '../../hooks/momentLocale'
import {addDayToRange, isDate, parseLocalizedDate} from '../../widgets/dateUtils'

import './date.scss'

import {PropertyProps} from '../types'

export type DateProperty = {
    from?: number
    to?: number
    includeTime?: boolean
    timeZone?: string
}

export function createDatePropertyFromString(initialValue: string): DateProperty {
    let dateProperty: DateProperty = {}
    if (initialValue) {
        const singleDate = new Date(Number(initialValue))
        if (singleDate && isDate(singleDate)) {
            dateProperty.from = singleDate.getTime()
        } else {
            try {
                dateProperty = JSON.parse(initialValue)
            } catch {
                //Don't do anything, return empty dateProperty
            }
        }
    }
    return dateProperty
}

function datePropertyToString(dateProperty: DateProperty): string {
    return dateProperty.from || dateProperty.to ? JSON.stringify(dateProperty) : ''
}

function DateRange(props: PropertyProps): JSX.Element {
    const [value, setValue] = createSignal(props.propertyValue)
    const intl = useIntl()

    // Track only the prop: an effect that also read value() would fire on the
    // local edit it is meant to survive and stomp it with the stale prop.
    createEffect(on(() => props.propertyValue, (propertyValue) => {
        setValue(propertyValue)
    }, {defer: true}))

    const onChange = (newValue: string) => {
        if (value() !== newValue) {
            setValue(newValue)
        }
    }

    const getDisplayDate = (date: Date | null | undefined) => {
        let displayDate = ''
        if (date) {
            displayDate = Utils.displayDate(date, intl)
        }
        return displayDate
    }

    const timeZoneOffset = (date: number): number => {
        return new Date(date).getTimezoneOffset() * 60 * 1000
    }

    const dateProperty = createMemo(() => createDatePropertyFromString(value() as string))
    const [showDialog, setShowDialog] = createSignal(false)

    // Keep dateProperty as UTC,
    // dateFrom / dateTo will need converted to local time, to ensure date stays consistent
    // dateFrom / dateTo will be used for input and calendar dates
    const dateFrom = () => (dateProperty().from ? new Date(dateProperty().from! + (dateProperty().includeTime ? 0 : timeZoneOffset(dateProperty().from!))) : undefined)
    const dateTo = () => (dateProperty().to ? new Date(dateProperty().to! + (dateProperty().includeTime ? 0 : timeZoneOffset(dateProperty().to!))) : undefined)
    const [fromInput, setFromInput] = createSignal<string>(getDisplayDate(dateFrom()))
    const [toInput, setToInput] = createSignal<string>(getDisplayDate(dateTo()))

    const isRange = () => dateTo() !== undefined

    const locale = () => intl.locale.toLowerCase()
    const momentRevision = useMomentLocale(locale)
    const firstDayOfWeek = () => {
        momentRevision()
        return moment.localeData(locale()).firstDayOfWeek()
    }

    const saveRangeValue = (range: DateProperty) => {
        const rangeUTC = {...range}
        if (rangeUTC.from) {
            rangeUTC.from -= dateProperty().includeTime ? 0 : timeZoneOffset(rangeUTC.from)
        }
        if (rangeUTC.to) {
            rangeUTC.to -= dateProperty().includeTime ? 0 : timeZoneOffset(rangeUTC.to)
        }

        onChange(datePropertyToString(rangeUTC))
        setFromInput(getDisplayDate(range.from ? new Date(range.from) : undefined))
        setToInput(getDisplayDate(range.to ? new Date(range.to) : undefined))
    }

    const handleDayClick = (day: Date) => {
        const range: DateProperty = {}
        day.setHours(12)
        if (isRange()) {
            const newRange = addDayToRange(day, {from: dateFrom(), to: dateTo()})
            range.from = newRange.from?.getTime()
            range.to = newRange.to?.getTime()
        } else {
            range.from = day.getTime()
            range.to = undefined
        }
        saveRangeValue(range)
    }

    const onRangeClick = () => {
        let range: DateProperty = {
            from: dateFrom()?.getTime(),
            to: dateFrom()?.getTime(),
        }
        if (isRange()) {
            range = ({
                from: dateFrom()?.getTime(),
                to: undefined,
            })
        }
        saveRangeValue(range)
    }

    const onClear = () => {
        saveRangeValue({})
    }

    const displayValue = () => {
        let display = ''
        if (dateFrom()) {
            display = getDisplayDate(dateFrom())
        }
        if (dateTo()) {
            display += ' → ' + getDisplayDate(dateTo())
        }
        return display
    }

    const onClose = () => {
        const newDate = datePropertyToString(dateProperty())
        onChange(newDate)
        mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate.id, newDate)
        setShowDialog(false)
    }

    const buttonText = () => {
        if (displayValue()) {
            return displayValue()
        }
        if (props.showEmptyPlaceholder) {
            return intl.formatMessage({id: 'DateRange.empty', defaultMessage: 'Empty'})
        }
        return ''
    }

    const classes = () => props.property.valueClassName(props.readOnly)

    return (
        <Show
            when={!props.readOnly}
            fallback={<div class={classes()}>{displayValue()}</div>}
        >
            <div class={`DateRange ${displayValue() ? '' : 'empty'} ` + classes()}>
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
                                class={classes() + '-overlayWrapper'}
                            >
                                <div class={classes() + '-overlay'}>
                                    <div class={'inputContainer'}>
                                        <Editable
                                            value={fromInput()}
                                            placeholderText={moment.localeData(locale()).longDateFormat('L')}
                                            onFocus={() => {
                                                const from = dateFrom()
                                                if (from) {
                                                    return setFromInput(Utils.inputDate(from, intl))
                                                }
                                                return undefined
                                            }}
                                            onChange={setFromInput}
                                            onSave={() => {
                                                const newDate = parseLocalizedDate(fromInput(), intl.locale)
                                                if (newDate && isDate(newDate)) {
                                                    newDate.setHours(12)
                                                    const range: DateProperty = {
                                                        from: newDate.getTime(),
                                                        to: dateTo()?.getTime(),
                                                    }
                                                    saveRangeValue(range)
                                                } else {
                                                    setFromInput(getDisplayDate(dateFrom()))
                                                }
                                            }}
                                            onCancel={() => {
                                                setFromInput(getDisplayDate(dateFrom()))
                                            }}
                                        />
                                        <Show when={dateTo()}>
                                            <Editable
                                                value={toInput()}
                                                placeholderText={moment.localeData(locale()).longDateFormat('L')}
                                                onFocus={() => {
                                                    const to = dateTo()
                                                    if (to) {
                                                        return setToInput(Utils.inputDate(to, intl))
                                                    }
                                                    return undefined
                                                }}
                                                onChange={setToInput}
                                                onSave={() => {
                                                    const newDate = parseLocalizedDate(toInput(), intl.locale)
                                                    if (newDate && isDate(newDate)) {
                                                        newDate.setHours(12)
                                                        const range: DateProperty = {
                                                            from: dateFrom()?.getTime(),
                                                            to: newDate.getTime(),
                                                        }
                                                        saveRangeValue(range)
                                                    } else {
                                                        setToInput(getDisplayDate(dateTo()))
                                                    }
                                                }}
                                                onCancel={() => {
                                                    setToInput(getDisplayDate(dateTo()))
                                                }}
                                            />
                                        </Show>
                                    </div>
                                    <Calendar
                                        onDayClick={handleDayClick}
                                        defaultMonth={dateFrom() || new Date()}
                                        firstDayOfWeek={firstDayOfWeek()}
                                        selection={{from: dateFrom(), to: dateTo()}}
                                        footer={
                                            <Button
                                                onClick={() => {
                                                    const today = new Date()
                                                    today.setHours(0, 0, 0, 0)
                                                    handleDayClick(today)
                                                }}
                                            >
                                                {intl.formatMessage({id: 'DateRange.today', defaultMessage: 'Today'})}
                                            </Button>
                                        }
                                    />
                                    <hr/>
                                    <SwitchOption
                                        id={'EndDateOn'}
                                        name={intl.formatMessage({id: 'DateRange.endDate', defaultMessage: 'End date'})}
                                        isOn={isRange()}
                                        onClick={onRangeClick}
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
        </Show>
    )
}

export default DateRange
