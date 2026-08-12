import {Show, createMemo} from 'solid-js'

import {useIntl} from '../intl'

import {Card} from '../blocks/card'
import {useAppSelector} from '../store/hooks'
import {getCardContents} from '../store/contents'
import {getCardComments} from '../store/comments'
import {ContentBlock} from '../blocks/contentBlock'
import {CommentBlock} from '../blocks/commentBlock'
import TextIcon from '../widgets/icons/text'
import MessageIcon from '../widgets/icons/message'
import CheckIcon from '../widgets/icons/check'
import {Utils} from '../utils'

import './cardBadges.scss'

type Props = {
    card: Card
    class?: string
}

type Checkboxes = {
    total: number
    checked: number
}

type Badges = {
    description: boolean
    comments: number
    checkboxes: Checkboxes
}

const hasBadges = (badges: Badges): boolean => {
    return badges.description || badges.comments > 0 || badges.checkboxes.total > 0
}

type ContentsType = Array<ContentBlock | ContentBlock[]>

const calculateBadges = (contents: ContentsType, comments: CommentBlock[]): Badges => {
    let text = 0
    let total = 0
    let checked = 0

    const updateCounters = (block: ContentBlock) => {
        if (block.type === 'text') {
            text++
            const checkboxes = Utils.countCheckboxesInMarkdown(block.title)
            total += checkboxes.total
            checked += checkboxes.checked
        } else if (block.type === 'checkbox') {
            total++
            if (block.fields.value) {
                checked++
            }
        }
    }

    for (const content of contents) {
        if (Array.isArray(content)) {
            content.forEach(updateCounters)
        } else {
            updateCounters(content)
        }
    }
    return {
        description: text > 0,
        comments: comments.length,
        checkboxes: {
            total,
            checked,
        },
    }
}

const CardBadges = (props: Props) => {
    const contents = useAppSelector((state) => getCardContents(props.card.id)(state))
    const comments = useAppSelector((state) => getCardComments(props.card.id)(state))
    const badges = createMemo(() => calculateBadges(contents(), comments()))
    const intl = useIntl()

    return (
        <Show when={hasBadges(badges())}>
            <div class={`CardBadges ${props.class || ''}`}>
                <Show when={badges().description}>
                    <span title={intl.formatMessage({id: 'CardBadges.title-description', defaultMessage: 'This card has a description'})}>
                        <TextIcon/>
                    </span>
                </Show>
                <Show when={badges().comments > 0}>
                    <span title={intl.formatMessage({id: 'CardBadges.title-comments', defaultMessage: 'Comments'})}>
                        <MessageIcon/>
                        {badges().comments}
                    </span>
                </Show>
                <Show when={badges().checkboxes.total > 0}>
                    <span title={intl.formatMessage({id: 'CardBadges.title-checkboxes', defaultMessage: 'Checkboxes'})}>
                        <CheckIcon/>
                        {`${badges().checkboxes.checked}/${badges().checkboxes.total}`}
                    </span>
                </Show>
            </div>
        </Show>
    )
}

export default CardBadges
