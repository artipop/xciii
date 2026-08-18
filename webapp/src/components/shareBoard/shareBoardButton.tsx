import {Show, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import Button from '../../widgets/buttons/button'
import {useAppSelector} from '../../store/hooks'
import {getCurrentBoard} from '../../store/boards'
import Globe from '../../widgets/icons/globe'
import LockOutline from '../../widgets/icons/lockOutline'
import {BoardTypeOpen} from '../../blocks/board'

import './shareBoardButton.scss'

import ShareBoardDialog from './shareBoard'

type Props = {
    enableSharedBoards: boolean
}
const ShareBoardButton = (props: Props) => {
    const intl = useIntl()
    const [showShareDialog, setShowShareDialog] = createSignal(false)
    const board = useAppSelector(getCurrentBoard)

    const iconForBoardType = () => {
        if (board().type === BoardTypeOpen) {
            return <Globe/>
        }
        return <LockOutline/>
    }

    return (
        <div class='ShareBoardButton'>
            <Button
                title={intl.formatMessage({id: 'ShareBoard.share-title', defaultMessage: 'Share board'})}
                size='medium'
                emphasis='primary'
                icon={iconForBoardType()}
                onClick={() => {
                    setShowShareDialog(!showShareDialog())
                }}
            >
                <FormattedMessage
                    id='CenterPanel.Share'
                    defaultMessage='Share'
                />
            </Button>
            <Show when={showShareDialog()}>
                <ShareBoardDialog
                    onClose={() => setShowShareDialog(false)}
                    enableSharedBoards={props.enableSharedBoards}
                />
            </Show>
        </div>
    )
}

export default ShareBoardButton
