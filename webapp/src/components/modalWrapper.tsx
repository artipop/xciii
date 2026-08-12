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
