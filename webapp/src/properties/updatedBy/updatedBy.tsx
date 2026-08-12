import type {JSX} from 'solid-js'

import {Block} from '../../blocks/block'
import {useAppSelector} from '../../store/hooks'
import {getLastCardContent} from '../../store/contents'
import {getLastCardComment} from '../../store/comments'
import Person from '../person/person'

import {PropertyProps} from '../types'

const LastModifiedBy = (props: PropertyProps): JSX.Element => {
    const lastContent = useAppSelector(getLastCardContent(props.card.id || ''))
    const lastComment = useAppSelector(getLastCardComment(props.card.id))

    const latestBlock = (): Block => {
        if (!props.board) {
            return props.card
        }
        const allBlocks = [props.card, lastContent(), lastComment()].filter(Boolean) as Block[]
        const sortedBlocks = allBlocks.sort((a, b) => b.updateAt - a.updateAt)
        return sortedBlocks.length > 0 ? sortedBlocks[0] : props.card
    }

    return (
        <Person
            {...props}
            propertyValue={latestBlock().modifiedBy}
            readOnly={true} // created by is an immutable property, so will always be readonly
        />
    )
}

export default LastModifiedBy
