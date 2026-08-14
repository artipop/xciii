import {Board} from '../../blocks/board'
import {useIntl} from '../../intl'

import Dialog from '../dialog'

import WorkdirsPanel from './workdirsPanel'

// Where this board's agents work, on its own screen — reached from the board's
// ⋯ menu rather than folded into «Колонки и маршруты…». How a repository
// among them is worked in is asked on the repository's own row: it is a fact
// about that repository and holds on every board it is offered on.
//
// It was a fold of that dialog, under the canvas, and that was wrong twice
// over: setting up where an agent works is not a question about columns and
// routes, and a fold under a canvas is a place nobody opens. Which of these
// screens a board is offered follows what it asks for (its setup plan), so a
// board of shopping lists is never offered a deploy host or a repository.

type Props = {
    board: Board
    onClose: () => void
}

const WorkdirsDialog = (props: Props) => {
    const intl = useIntl()

    return (
        <Dialog
            class='WorkdirsDialog'
            title={<span>{intl.formatMessage({id: 'Workdirs.title', defaultMessage: 'Folders'})}</span>}
            onClose={props.onClose}
        >
            <div class='WorkdirsDialog__content'>
                <WorkdirsPanel board={props.board}/>
            </div>
        </Dialog>
    )
}

export default WorkdirsDialog
