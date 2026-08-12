import type {JSX} from 'solid-js'

import {useIntl} from '../../intl'

import {Utils} from '../../utils'
import {PropertyProps} from '../types'
import './createdTime.scss'

const CreatedTime = (props: PropertyProps): JSX.Element => {
    const intl = useIntl()
    return (
        <div class={`CreatedTime ${props.property.valueClassName(true)}`}>
            {Utils.displayDateTime(new Date(props.card.createAt), intl)}
        </div>
    )
}

export default CreatedTime
