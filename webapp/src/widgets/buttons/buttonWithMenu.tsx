// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import DropdownIcon from '../icons/dropdown'
import MenuWrapper from '../menuWrapper'

import './buttonWithMenu.scss'

type Props = {
    onClick?: (e: MouseEvent) => void
    children?: JSX.Element
    title?: string
    text: JSX.Element
}

function ButtonWithMenu(props: Props): JSX.Element {
    return (
        <div
            onClick={props.onClick}
            class='ButtonWithMenu'
            title={props.title}
        >
            <div class='button-text'>
                {props.text}
            </div>
            <MenuWrapper
                stopPropagationOnToggle={true}
                menu={props.children}
            >
                <div class='button-dropdown'>
                    <DropdownIcon/>
                </div>
            </MenuWrapper>
        </div>
    )
}

export default ButtonWithMenu
