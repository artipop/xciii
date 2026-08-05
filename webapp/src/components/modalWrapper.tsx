// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import './modalWrapper.scss'

type Props = {
    children: JSX.Element
}

const ModalWrapper = (props: Props) => {
    return (
        <div class='ModalWrapper'>
            {props.children}
        </div>
    )
}

export default ModalWrapper
