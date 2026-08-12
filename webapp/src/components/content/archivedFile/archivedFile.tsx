import type {JSX} from 'solid-js'

import {FileInfo} from '../../../blocks/block'
import BrokenFile from '../../../widgets/icons/brokenFile'
import {Utils} from '../../../utils'

import './archivedFile.scss'

type Props = {
    fileInfo: FileInfo
}

const ArchivedFile = (props: Props): JSX.Element => {
    const fileName = () => props.fileInfo.name || 'untitled file'

    const fileExtension = () => {
        let extension = props.fileInfo.extension
        extension = extension?.startsWith('.') ? extension?.substring(1) : extension
        return extension?.toUpperCase()
    }

    const fileSize = () => Utils.humanFileSize(props.fileInfo.size || 0)

    return (
        <div class='ArchivedFile'>
            <BrokenFile/>
            <div class='fileMetadata'>
                <p class='filename'>{fileName()}</p>
                <p>{fileExtension()} {fileSize()}</p>
            </div>
        </div>
    )
}

export default ArchivedFile
