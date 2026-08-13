import {Board} from '../../blocks/board'
import {useIntl} from '../../intl'

import Dialog from '../dialog'

import DeployTargetsPanel from './deployTargetsPanel'

// Where this board publishes, on its own screen. The registry behind it is the
// machine's — an SSH key is nothing a board owns — but what makes it worth
// asking about is a stage that deploys, so the door is offered only to a board
// whose setup plan has that step, and it is a door rather than a fold.

type Props = {
    board: Board
    onClose: () => void
    onChange?: () => void
}

const DeployTargetsDialog = (props: Props) => {
    const intl = useIntl()

    return (
        <Dialog
            class='DeployTargetsDialog'
            title={<span>{intl.formatMessage({id: 'Machine.section-deploys', defaultMessage: 'Where to deploy'})}</span>}
            onClose={props.onClose}
        >
            <DeployTargetsPanel onChange={props.onChange}/>
        </Dialog>
    )
}

export default DeployTargetsDialog
