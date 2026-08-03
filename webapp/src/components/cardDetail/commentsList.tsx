// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {CommentBlock, createCommentBlock} from '../../blocks/commentBlock'
import mutator from '../../mutator'
import {useAppSelector} from '../../store/hooks'
import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'

import {MarkdownEditor} from '../markdownEditor'

import {IUser} from '../../user'
import {getMe} from '../../store/users'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import {Permission} from '../../constants'

import AddCommentTourStep from '../onboardingTour/addComments/addComments'

import Comment from './comment'

import './commentsList.scss'

type Props = {
    comments: readonly CommentBlock[]
    boardId: string
    cardId: string
    readonly: boolean
}

const CommentsList = (props: Props) => {
    const [newComment, setNewComment] = createSignal('')
    const me = useAppSelector<IUser|null>(getMe)
    const canDeleteOthersComments = useHasCurrentBoardPermissions([Permission.DeleteOthersComments])

    const onSendClicked = () => {
        const commentText = newComment()
        if (commentText) {
            const {cardId, boardId} = props
            Utils.log(`Send comment: ${commentText}`)
            Utils.assertValue(cardId)

            const comment = createCommentBlock()
            comment.parentId = cardId
            comment.boardId = boardId
            comment.title = commentText
            mutator.insertBlock(boardId, comment, 'add comment')
            setNewComment('')
        }
    }

    const intl = useIntl()

    return (
        <div class='CommentsList'>
            {/* New comment */}
            <Show when={!props.readonly}>
                <div class='CommentsList__new'>
                    <img
                        class='comment-avatar'
                        src={Utils.getProfilePicture(me()?.id)}
                    />
                    <MarkdownEditor
                        className='newcomment'
                        text={newComment()}
                        placeholderText={intl.formatMessage({id: 'CardDetail.new-comment-placeholder', defaultMessage: 'Add a comment...'})}
                        onChange={(value: string) => {
                            if (newComment() !== value) {
                                setNewComment(value)
                            }
                        }}
                    />

                    <Show when={newComment()}>
                        <Button
                            filled={true}
                            onClick={onSendClicked}
                        >
                            <FormattedMessage
                                id='CommentsList.send'
                                defaultMessage='Send'
                            />
                        </Button>
                    </Show>

                    <AddCommentTourStep/>
                </div>
            </Show>

            <For each={props.comments.slice(0).reverse()}>
                {(comment) => {
                    // Only modify _own_ comments, EXCEPT for Admins, which can delete _any_ comment
                    // NOTE: editing comments will exist in the future (in addition to deleting)
                    const canDeleteComment = () => canDeleteOthersComments() || me()?.id === comment.modifiedBy
                    return (
                        <Comment
                            comment={comment}
                            userImageUrl={Utils.getProfilePicture(comment.modifiedBy)}
                            userId={comment.modifiedBy}
                            readonly={props.readonly || !canDeleteComment()}
                        />
                    )
                }}
            </For>

            {/* horizontal divider below comments */}
            <Show when={!(props.comments.length === 0 && props.readonly)}>
                <hr class='CommentsList__divider'/>
            </Show>
        </div>
    )
}

export default CommentsList
