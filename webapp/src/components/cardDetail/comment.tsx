// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import React, {FC} from 'react'
import {useIntl} from '../../intl'

import {Block} from '../../blocks/block'
import mutator from '../../mutator'
import {Utils} from '../../utils'
import IconButton from '../../widgets/buttons/iconButton'
import DeleteIcon from '../../widgets/icons/delete'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import {getUser} from '../../store/users'
import {useAppSelector} from '../../store/hooks'
import Tooltip from '../../widgets/tooltip'
import GuestBadge from '../../widgets/guestBadge'

import './comment.scss'

type Props = {
    comment: Block
    userId: string
    userImageUrl: string
    readonly: boolean
}

const Comment: Component<Props> = (props: Props) => {
    const {comment, userId, userImageUrl} = props
    const intl = useIntl()
    const html = Utils.htmlFromMarkdown(comment.title)
    const user = useAppSelector(getUser(userId))
    const date = new Date(comment.createAt)

    return (
        <div
            class='Comment comment'
        >
            <div class='comment-header'>
                <img
                    class='comment-avatar'
                    src={userImageUrl}
                />
                <div class='comment-username'>{user?.username}</div>
                <GuestBadge show={user?.is_guest}/>

                <Tooltip title={Utils.displayDateTime(date, intl)}>
                    <div class='comment-date'>
                        {Utils.relativeDisplayDateTime(date, intl)}
                    </div>
                </Tooltip>

                {!props.readonly && (
                    <MenuWrapper>
                        <IconButton icon={<OptionsIcon/>}/>
                        <Menu position='left'>
                            <Menu.Text
                                icon={<DeleteIcon/>}
                                id='delete'
                                name={intl.formatMessage({id: 'Comment.delete', defaultMessage: 'Delete'})}
                                onClick={() => mutator.deleteBlock(comment)}
                            />
                        </Menu>
                    </MenuWrapper>
                )}
            </div>
            <div
                class='comment-text'
                dangerouslySetInnerHTML={{__html: html}}
            />
        </div>
    )
}

export default Comment
