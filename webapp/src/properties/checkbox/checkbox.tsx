import type {JSX} from 'solid-js'

import mutator from '../../mutator'
import Switch from '../../widgets/switch'

import {PropertyProps} from '../types'

const Checkbox = (props: PropertyProps): JSX.Element => {
    return (
        <Switch
            isOn={Boolean(props.propertyValue)}
            onChanged={(newBool: boolean) => {
                const newValue = newBool ? 'true' : ''
                mutator.changePropertyValue(props.board.id, props.card, props.propertyTemplate?.id || '', newValue)
            }}
            readOnly={props.readOnly}
        />
    )
}
export default Checkbox
