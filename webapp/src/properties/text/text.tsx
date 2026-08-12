import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'
import BaseTextEditor from '../baseTextEditor'

const Text = (props: PropertyProps): JSX.Element => {
    return (
        <BaseTextEditor
            {...props}
            validator={() => true}
            spellCheck={true}
        />
    )
}
export default Text
