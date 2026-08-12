import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {Block} from '../../blocks/block'
import {Utils} from '../../utils'
import {useAppSelector} from '../../store/hooks'
import {getLastCardContent} from '../../store/contents'
import {getLastCardComment} from '../../store/comments'
import './updatedTime.scss'

import {PropertyProps} from '../types'

const UpdatedTime = (props: PropertyProps): JSX.Element => {
    const intl = useIntl()
    const lastContent = useAppSelector(getLastCardContent(props.card.id || ''))
    const lastComment = useAppSelector(getLastCardComment(props.card.id))

    const latestBlock = (): Block => {
        if (!props.card) {
            return props.card
        }
        const allBlocks = [props.card, lastContent(), lastComment()].filter(Boolean) as Block[]
        const sortedBlocks = allBlocks.sort((a, b) => b.updateAt - a.updateAt)
        return sortedBlocks.length > 0 ? sortedBlocks[0] : props.card
    }

    return (
        <div class={`UpdatedTime ${props.property.valueClassName(true)}`}>
            {Utils.displayDateTime(new Date(latestBlock().updateAt), intl)}
        </div>
    )
}

export default UpdatedTime
