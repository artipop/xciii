import OptionsIcon from '../../widgets/icons/options'
import IconButton from '../../widgets/buttons/iconButton'

import './cardActionsMenuIcon.scss'

const CardActionsMenuIcon = () => {
    return (
        <IconButton
            class='CardActionsMenuIcon'
            icon={<OptionsIcon/>}
        />
    )
}

export default CardActionsMenuIcon
