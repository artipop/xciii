// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {MenuOptionProps} from './menuItem'

import './colorOption.scss'

type ColorOptionProps = MenuOptionProps & {
    icon?: JSX.Element
}

function ColorOption(props: ColorOptionProps): JSX.Element {
    const intl = useIntl()
    return (
        <div
            role='button'
            aria-label={intl.formatMessage({id: 'ColorOption.selectColor', defaultMessage: 'Select {color} Color'}, {color: props.name})}
            class='MenuOption ColorOption menu-option'
            onClick={(e: MouseEvent): void => {
                (e.target as HTMLElement).dispatchEvent(new Event('menuItemClicked'))
                props.onClick(props.id)
                e.stopPropagation()
            }}
        >
            {props.icon ?? <div class='noicon'/>}
            <div class='menu-name'>{props.name}</div>
            <div class={`menu-colorbox ${props.id}`}/>
        </div>
    )
}

export default ColorOption
