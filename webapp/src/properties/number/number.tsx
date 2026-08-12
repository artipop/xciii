import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'
import BaseTextEditor from '../baseTextEditor'

const Number = (props: PropertyProps): JSX.Element => {
    return (
        <BaseTextEditor
            {...props}
            validator={() => props.propertyValue === '' || !isNaN(parseInt(props.propertyValue as string, 10))}
        />
    )
}
export default Number
