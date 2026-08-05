// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import OptionsIcon from '../../widgets/icons/options'
import IconButton from '../../widgets/buttons/iconButton'

import './cardActionsMenuIcon.scss'

const CardActionsMenuIcon = () => {
    return (
        <IconButton
            class='CardActionsMenuIcon'
            icon={<OptionsIcon/>}
        />
    )
}

export default CardActionsMenuIcon
