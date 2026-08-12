import {Show} from 'solid-js'
import type {Component} from 'solid-js'

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
import useMomentLocale from '../../hooks/momentLocale'
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
    const intl = useIntl()
    const html = () => Utils.htmlFromMarkdown(props.comment.title)
    const user = useAppSelector((state) => getUser(props.userId)(state))
    const date = () => new Date(props.comment.createAt)

    // «2 часа назад» is moment's phrasing, and moment only knows it once the
    // locale definitions have arrived. Read the revision inside the same
    // expression that formats, or the comment keeps the English it was first
    // drawn with.
    const momentRevision = useMomentLocale(() => intl.locale.toLowerCase())
    const relativeDate = () => {
        momentRevision()
        return Utils.relativeDisplayDateTime(date(), intl)
    }

    // A session's report is a log entry, not somebody talking; the Go side
    // marks the comments it writes so the card can say so.
    const fromAgent = () => Boolean((props.comment.fields as {agent?: boolean} | undefined)?.agent)

    return (
        <div
            class={`Comment comment${fromAgent() ? ' Comment--agent' : ''}`}
        >
            <div class='comment-header'>
                <img
                    class='comment-avatar'
                    src={props.userImageUrl}
                />
                <div class='comment-username'>{user()?.username}</div>
                <GuestBadge show={user()?.is_guest}/>

                <Tooltip title={Utils.displayDateTime(date(), intl)}>
                    <div class='comment-date'>
                        {relativeDate()}
                    </div>
                </Tooltip>

                <Show when={!props.readonly}>
                    <MenuWrapper
                        menu={
                            <Menu position='left'>
                                <Menu.Text
                                    icon={<DeleteIcon/>}
                                    id='delete'
                                    name={intl.formatMessage({id: 'Comment.delete', defaultMessage: 'Delete'})}
                                    onClick={() => mutator.deleteBlock(props.comment)}
                                />
                            </Menu>
                        }
                    >
                        <IconButton icon={<OptionsIcon/>}/>
                    </MenuWrapper>
                </Show>
            </div>
            <div
                class='comment-text'
                innerHTML={html()}
            />
        </div>
    )
}

export default Comment
