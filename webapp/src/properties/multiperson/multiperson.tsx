import type {JSX} from 'solid-js'

import {PropertyProps} from '../types'
import ConfirmPerson from '../person/confirmPerson'

const MultiPerson = (props: PropertyProps): JSX.Element => {
    return (
        <ConfirmPerson
            {...props}
            showEmptyPlaceholder={true}
        />
    )
}

export default MultiPerson
