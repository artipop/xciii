// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import Menu from './menu'
import MenuWrapper from './menuWrapper'
import CheckIcon from './icons/check'
import DropdownIcon from './icons/dropdown'

import './select.scss'

// Choosing one of a list, in the app's own hand.
//
// A native <select> is drawn by the platform and not by us: it keeps the
// system's white on the dark board, the system's font instead of the two this
// product sets, and it drops a list no stylesheet can reach. Beside the board's
// own menus — which is where all of these stand — it reads as a control from a
// different program. This is that menu (widgets/menu) behind a control shaped
// like the inputs it sits next to, so a form has one voice throughout.
//
// The options are given rather than nested as children, because every caller
// has a list already and none of them wanted a menu — they wanted a field.

export type SelectOption = {
    value: string
    label: string
    disabled?: boolean
}

type Props = {
    value: string
    options: SelectOption[]
    onChange: (value: string) => void

    // What the control says when the value matches no option — the empty
    // choice of a field where "nothing" is an answer. An option for it belongs
    // in `options` too, or there is no way back to nothing.
    placeholder?: string

    // The field's name, for anyone who cannot see which label it stands under.
    label?: string

    class?: string
    disabled?: boolean
}

const Select = (props: Props): JSX.Element => {
    const current = () => props.options.find((o) => o.value === props.value)
    const text = () => current()?.label ?? props.placeholder ?? ''

    return (
        <MenuWrapper
            class={`Select${props.class ? ' ' + props.class : ''}`}
            label={props.label}
            disabled={props.disabled}

            // Most of these stand inside a <label> with their caption, and a
            // click anywhere in a label is forwarded by the browser to the
            // control it labels — our own trigger, which had just opened the
            // menu and now closed it again. The field looked dead. Cancelling
            // the click is what stops the label from acting on it.
            stopPropagationOnToggle={true}
            menu={
                <Menu position='bottom'>
                    <For each={props.options}>
                        {(option) => (
                            <Menu.Text
                                id={option.value}
                                name={option.label}
                                disabled={option.disabled}
                                check={true}
                                icon={option.value === props.value ? <CheckIcon/> : <div class='empty-icon'/>}
                                onClick={() => {
                                    if (!option.disabled) {
                                        props.onChange(option.value)
                                    }
                                }}
                            />
                        )}
                    </For>
                </Menu>
            }
        >
            {/* The field's name is on the wrapper, which is the thing that
                opens the menu; the button inside is named by what it shows.
                Stated rather than left to the text, because these stand inside
                a <label> and a button in a label takes the label's name — both
                halves would then answer to "Kind" and neither could be asked
                for on its own. */}
            <button
                type='button'
                class='Select__trigger'
                disabled={props.disabled}
                aria-label={text()}
            >
                <Show
                    when={current()}
                    fallback={<span class='Select__value Select__value--empty'>{text()}</span>}
                >
                    <span class='Select__value'>{text()}</span>
                </Show>
                <DropdownIcon/>
            </button>
        </MenuWrapper>
    )
}

export default Select
