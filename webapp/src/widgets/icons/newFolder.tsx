import type {JSX} from 'solid-js'

import CompassIcon from './compassIcon'

export default function CreateNewFolder(): JSX.Element {
    return (
        <CompassIcon
            icon='folder-plus-outline'
            class='CreateNewFolderIcon'
        />
    )
}
