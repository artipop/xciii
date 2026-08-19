import {useIntl} from '../../intl'

import {CommentBlock} from '../../blocks/commentBlock'
import CompassIcon from '../../widgets/icons/compassIcon'

import CommentsList from './commentsList'

import './cardComments.scss'

// What people say about a card to each other, beside the card rather than
// inside it (docs/teamwork.md).
//
// The body of a card is what a person wrote, and everything the machinery put
// in there has already been taken out — the agent's line, the session status,
// the «какая папка» form. A comment is the same case: it is a conversation
// about the card, not part of it.
//
// So it shares the panel the terminal has, and the two are the same question
// asked of two different readers — what to tell the agent about this card, and
// what to tell the person who comes to it later. Which one is drawn is the
// dialog's toolbar; the ✕ here closes the panel, exactly as the terminal's
// does.

type Props = {
    cardId: string
    boardId: string
    comments: readonly CommentBlock[]
    readonly: boolean
    onClose: () => void
}

const CardComments = (props: Props) => {
    const intl = useIntl()

    return (
        <div class='CardComments'>
            <div class='CardComments__head'>
                <span class='CardComments__title'>
                    {intl.formatMessage({id: 'CardComments.title', defaultMessage: 'Comments'})}
                </span>
                <div class='CardComments__actions'>
                    <button
                        type='button'
                        class='CardComments__button'
                        title={intl.formatMessage({id: 'CardComments.close', defaultMessage: 'Close the panel'})}
                        aria-label={intl.formatMessage({id: 'CardComments.close', defaultMessage: 'Close the panel'})}
                        onClick={() => props.onClose()}
                    >
                        <CompassIcon icon='close'/>
                    </button>
                </div>
            </div>

            <div class='CardComments__body'>
                <CommentsList
                    comments={props.comments}
                    boardId={props.boardId}
                    cardId={props.cardId}
                    readonly={props.readonly}
                />
            </div>
        </div>
    )
}

export default CardComments
