import {For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, onMount} from 'solid-js'
import {Portal} from 'solid-js/web'
import type {JSX} from 'solid-js'
import {autoUpdate, computePosition, flip, offset, shift, size} from '@floating-ui/dom'

import {
    filterRows,
    firstOption,
    keyIntent,
    nextOption,
    optionAt,
    toRows,
    type ComboboxItem,
    type ComboboxOption,
    type ComboboxRow,
} from '../combobox'

import './combobox.scss'

// Where an option is being drawn: in the menu, or as the chosen value. This is
// react-select's `meta.context`, which several call sites switch on to show a
// short label in the control and a long one in the list.
export type ComboboxContext = 'menu' | 'value'

export type ComboboxAction = 'select' | 'remove' | 'clear' | 'create'

type Props<T> = {

    // Either a list, or a function that fetches one for the query typed so far.
    options?: Array<ComboboxItem<T>>
    loadOptions?: (query: string) => Promise<Array<ComboboxItem<T>>>

    value?: ComboboxOption<T> | Array<ComboboxOption<T>> | null

    isMulti?: boolean
    isClearable?: boolean
    isDisabled?: boolean
    isSearchable?: boolean
    autoFocus?: boolean

    placeholder?: string
    noOptionsMessage?: string
    ariaLabel?: string

    // What a screen reader is told once the list is open. Passed in rather than
    // translated here, so the widget needs no i18n provider above it.
    resultsMessage?: (count: number) => string
    clearLabel?: string

    class?: string

    // The class names the menu and its rows answer to. Several stylesheets are
    // written against react-select's own `classNamePrefix` output, so this
    // keeps emitting those names rather than asking them to be rewritten.
    classNamePrefix: string

    // Left undefined the menu opens on focus and closes on choice; given a
    // value it is the caller's to control.
    menuIsOpen?: boolean
    closeMenuOnSelect?: boolean

    // Somewhere other than in place, for a menu that would be clipped.
    portalTarget?: HTMLElement | null

    matches?: (option: ComboboxOption<T>, query: string) => boolean
    renderOption?: (option: ComboboxOption<T>, context: ComboboxContext) => JSX.Element

    // Set when what `renderOption` draws is not a row to pick but a menu of its
    // own -- the calculation options open a submenu and commit their own value.
    // react-select said this by handing a custom Option its `innerProps` and
    // letting it ignore them; said out loud, it is one flag.
    optionsOwnTheirClicks?: boolean

    // Set when what `renderOption` draws for a chosen value already carries its
    // own way of taking it off, so the widget adds none.
    valuesOwnTheirRemove?: boolean

    onChange: (value: ComboboxOption<T> | Array<ComboboxOption<T>> | null, action: ComboboxAction) => void
    onCreate?: (label: string) => void
    onBlur?: () => void
    onFocus?: (event: FocusEvent) => void
    onKeyDown?: (event: KeyboardEvent) => void

    inputValue?: string
    onInputChange?: (value: string) => void
}

const MENU_OFFSET = 4
const MENU_PADDING = 8

function asArray<T>(value: Props<T>['value']): Array<ComboboxOption<T>> {
    if (!value) {
        return []
    }
    return Array.isArray(value) ? value : [value]
}

function Combobox<T>(props: Props<T>): JSX.Element {
    const isSearchable = () => props.isSearchable ?? true
    const closeMenuOnSelect = () => props.closeMenuOnSelect ?? !props.isMulti

    let controlRef: HTMLDivElement | undefined
    let inputRef: HTMLInputElement | undefined
    const listId = createUniqueId()

    const [focused, setFocused] = createSignal(false)
    const [ownQuery, setOwnQuery] = createSignal('')
    const [highlight, setHighlight] = createSignal(-1)
    const [loaded, setLoaded] = createSignal<Array<ComboboxItem<T>>>([])

    // Programmatic, the way react-select's autoFocus prop was: the attribute
    // alone is a hint browsers apply inconsistently to elements inserted after
    // load, and the single-select menu opens on focus.
    onMount(() => {
        if (props.autoFocus) {
            inputRef?.focus()
        }
    })

    const query = () => (props.inputValue === undefined ? ownQuery() : props.inputValue)
    const isOpen = () => (props.menuIsOpen === undefined ? focused() : props.menuIsOpen)
    const selected = () => asArray(props.value)

    // An async list is already the answer to the query, so it is never filtered
    // a second time on this side.
    const rows = createMemo((): Array<ComboboxRow<T>> => {
        if (props.loadOptions) {
            return toRows(loaded())
        }
        return filterRows(toRows(props.options || []), query(), props.matches)
    })

    // Loaded on mount as well as on every query, which is what react-select's
    // `defaultOptions` did: the list is expected to be there before the menu is
    // opened, not fetched in the moment it opens.
    createEffect(() => {
        if (!props.loadOptions) {
            return
        }

        let cancelled = false
        props.loadOptions(query()).then((items) => {
            if (!cancelled) {
                setLoaded(items)
            }
        }).catch(() => {
            if (!cancelled) {
                setLoaded([])
            }
        })
        onCleanup(() => {
            cancelled = true
        })
    })

    // Nothing is highlighted until the list has something to highlight, and a
    // list that changed under the cursor starts again at the top.
    createEffect(() => {
        setHighlight(isOpen() ? firstOption(rows()) : -1)
    })

    const choose = (option: ComboboxOption<T>) => {
        if (props.isMulti) {
            props.onChange([...selected(), option], 'select')
        } else {
            props.onChange(option, 'select')
        }

        if (props.inputValue === undefined) {
            setOwnQuery('')
        }
        if (closeMenuOnSelect()) {
            setFocused(false)
            inputRef?.blur()
        }
    }

    const remove = (option: ComboboxOption<T>) => {
        props.onChange(selected().filter((each) => each.id !== option.id), 'remove')
    }

    const onKeyDown = (event: KeyboardEvent) => {
        props.onKeyDown?.(event)
        if (event.defaultPrevented) {
            return
        }

        switch (keyIntent(event.key, isOpen(), query().length > 0)) {
        case 'open':
            event.preventDefault()
            setFocused(true)
            break
        case 'close':
            event.preventDefault()
            setFocused(false)
            break
        case 'next':
        case 'previous': {
            event.preventDefault()
            const delta = event.key === 'ArrowDown' ? 1 : -1
            setHighlight((current) => nextOption(rows(), current, delta))
            break
        }
        case 'choose': {
            const option = optionAt(rows(), highlight())
            if (option) {
                event.preventDefault()
                choose(option)
            } else if (props.onCreate && query().trim()) {
                event.preventDefault()
                props.onCreate(query().trim())
                if (props.inputValue === undefined) {
                    setOwnQuery('')
                }
            }
            break
        }
        case 'removeLast':
            if (props.isMulti && selected().length > 0) {
                remove(selected()[selected().length - 1])
            }
            break
        default:
        }
    }

    const setQuery = (value: string) => {
        if (props.inputValue === undefined) {
            setOwnQuery(value)
        }
        props.onInputChange?.(value)
    }

    const label = (option: ComboboxOption<T>, context: ComboboxContext) =>
        (props.renderOption ? props.renderOption(option, context) : option.label)

    const optionCount = () => rows().filter((row) => row.kind === 'option').length

    return (
        <div class={`Combobox ${props.class || ''}`}>

            {/* What react-select announced for a screen reader, and what a
                combobox without one silently stops saying: how many results
                the typing left, and that the arrows move through them. */}
            <span
                class='Combobox__live-region'
                role='log'
                aria-live='polite'
                aria-atomic='false'
                aria-relevant='additions text'
            >
                {isOpen() && props.resultsMessage?.(optionCount())}
            </span>
            <div
                ref={controlRef}
                class={`${props.classNamePrefix}__control`}

                // Anywhere on the control is the input, so clicking the
                // placeholder or the gap beside a chip opens the list.
                onClick={() => inputRef?.focus()}
            >
                <div class={props.isMulti ? `${props.classNamePrefix}__value-container ${props.classNamePrefix}__value-container--is-multi` : `${props.classNamePrefix}__value-container`}>
                    <Show when={props.isMulti}>
                        <For each={selected()}>
                            {(option) => (
                                <div
                                    class={`${props.classNamePrefix}__multi-value`}

                                    // Keeps the focus on the input: a caller that draws
                                    // its own control inside a value would otherwise see
                                    // the blur close the editor, and its own click land
                                    // on a node no longer in the document.
                                    onMouseDown={(event) => event.preventDefault()}
                                >
                                    <div class={`${props.classNamePrefix}__multi-value__label`}>
                                        {label(option, 'value')}
                                    </div>
                                    <Show when={!props.valuesOwnTheirRemove}>
                                        <div
                                            class={`${props.classNamePrefix}__multi-value__remove`}
                                            role='button'
                                            tabIndex={-1}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => remove(option)}
                                        >
                                            {'×'}
                                        </div>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </Show>
                    <Show when={!props.isMulti && selected().length > 0 && !query()}>
                        <div
                            class={`${props.classNamePrefix}__single-value`}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {label(selected()[0], 'value')}
                        </div>
                    </Show>
                    <Show when={selected().length === 0 && !query()}>
                        <div class={`${props.classNamePrefix}__placeholder`}>
                            {props.placeholder}
                        </div>
                    </Show>
                    {/* Two classes on purpose: the prefixed one is what call
                        sites style, and the stable one is what this widget's own
                        stylesheet can reach without knowing the prefix. */}
                    <input
                        ref={inputRef}
                        class={`Combobox__input ${props.classNamePrefix}__input`}
                        type='text'
                        role='combobox'
                        aria-expanded={isOpen()}
                        aria-controls={listId}
                        aria-activedescendant={highlight() >= 0 ? `${listId}-option-${highlight()}` : undefined}
                        aria-label={props.ariaLabel}
                        autocomplete='off'
                        autofocus={props.autoFocus}
                        disabled={props.isDisabled}
                        readOnly={!isSearchable()}
                        value={query()}
                        onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
                        onFocus={(event) => {
                            setFocused(true)
                            props.onFocus?.(event)
                        }}
                        onBlur={() => {
                            setFocused(false)
                            props.onBlur?.()
                        }}
                        onKeyDown={onKeyDown}
                    />
                </div>
                <Show when={props.isClearable && selected().length > 0 && !props.isDisabled}>
                    <div
                        class={`${props.classNamePrefix}__clear-indicator`}
                        role='button'
                        tabIndex={-1}
                        aria-label={props.clearLabel}
                        title={props.clearLabel}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => props.onChange(props.isMulti ? [] : null, 'clear')}
                    >
                        {'×'}
                    </div>
                </Show>
            </div>
            <Show when={isOpen()}>
                <ComboboxMenu
                    anchor={() => controlRef}
                    portalTarget={props.portalTarget}
                    class={`${props.classNamePrefix}__menu`}
                >
                    <div
                        class={`${props.classNamePrefix}__menu-list`}
                        id={listId}
                        role='listbox'
                    >
                        <Show when={rows().length === 0}>
                            <div class={`${props.classNamePrefix}__no-options`}>
                                {props.noOptionsMessage}
                            </div>
                        </Show>
                        <For each={rows()}>
                            {(row, index) => {
                                if (row.kind === 'group') {
                                    return (
                                        <div class={`${props.classNamePrefix}__group-heading`}>
                                            {row.label}
                                        </div>
                                    )
                                }

                                const isSelected = () => selected().some((each) => each.id === row.option.id)
                                const names = () => {
                                    const list = [`${props.classNamePrefix}__option`]
                                    if (index() === highlight()) {
                                        list.push(`${props.classNamePrefix}__option--is-focused`)
                                    }
                                    if (isSelected()) {
                                        list.push(`${props.classNamePrefix}__option--is-selected`)
                                    }
                                    return list.join(' ')
                                }

                                return (
                                    <div
                                        id={`${listId}-option-${index()}`}
                                        class={names()}
                                        role='option'
                                        aria-selected={isSelected()}

                                        // mousedown only holds the focus on the input, so
                                        // the menu is still there when the click lands on
                                        // it; the click is what chooses.
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={props.optionsOwnTheirClicks ? undefined : () => choose(row.option)}
                                        onMouseEnter={() => setHighlight(index())}
                                    >
                                        {label(row.option, 'menu')}
                                    </div>
                                )
                            }}
                        </For>
                    </div>
                </ComboboxMenu>
            </Show>
        </div>
    )
}

type MenuProps = {
    anchor: () => HTMLElement | undefined
    portalTarget?: HTMLElement | null
    class: string
    children: JSX.Element
}

// The menu is placed by Floating UI and matched to the width of the control,
// which is what react-select's own popper was doing for it.
const ComboboxMenu = (props: MenuProps): JSX.Element => {
    const [menu, setMenu] = createSignal<HTMLDivElement | null>(null)
    const [position, setPosition] = createSignal<{x: number, y: number} | null>(null)

    createEffect(() => {
        const reference = props.anchor()
        const floating = menu()
        if (!reference || !floating) {
            return
        }

        const stop = autoUpdate(reference, floating, () => {
            computePosition(reference, floating, {
                placement: 'bottom-start',
                middleware: [
                    offset(MENU_OFFSET),
                    flip(),
                    shift({padding: MENU_PADDING}),
                    size({
                        padding: MENU_PADDING,
                        apply: ({rects, availableHeight, elements}) => {
                            elements.floating.style.minWidth = `${rects.reference.width}px`
                            elements.floating.style.maxHeight = `${availableHeight}px`
                        },
                    }),
                ],
            }).then(({x, y}) => setPosition({x, y}))
        })
        onCleanup(stop)
    })

    const node = (
        <div
            ref={setMenu}
            class={`Combobox__menu ${props.class} ${position() ? 'is-positioned' : ''}`}
            style={position() ? {transform: `translate(${Math.round(position()!.x)}px, ${Math.round(position()!.y)}px)`} : undefined}
        >
            {props.children}
        </div>
    )

    return (
        <Show
            when={props.portalTarget}
            fallback={node}
        >
            <Portal mount={props.portalTarget!}>{node}</Portal>
        </Show>
    )
}

export default Combobox
