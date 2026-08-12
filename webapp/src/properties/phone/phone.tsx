import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'
import BaseTextEditor from '../baseTextEditor'

const Phone = (props: PropertyProps): JSX.Element => {
    return (
        <BaseTextEditor
            {...props}
            validator={() => true}
        />
    )
}
export default Phone
