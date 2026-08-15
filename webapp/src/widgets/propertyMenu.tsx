import {For} from 'solid-js'

// See LICENSE.txt for license information.
import type {JSX} from 'solid-js'

import {useIntl, IntlShape} from '../intl'

import Menu from '../widgets/menu'
import propsRegistry from '../properties'
import {PropertyType} from '../properties/types'
import './propertyMenu.scss'

type Props = {
    propertyId: string
    propertyName: string
    propertyType: PropertyType
    onTypeAndNameChanged: (newType: PropertyType, newName: string) => void
    onDelete: (id: string) => void
}

function typeMenuTitle(intl: IntlShape, type: PropertyType): string {
    return `${intl.formatMessage({id: 'PropertyMenu.typeTitle', defaultMessage: 'Type'})}: ${type.displayName(intl)}`
}

type TypesProps = {
    label: string
    onTypeSelected: (type: PropertyType) => void
}

export const PropertyTypes = (props: TypesProps): JSX.Element => {
    const intl = useIntl()
    return (
        <>
            <Menu.Label>
                <b>{props.label}</b>
            </Menu.Label>

            <Menu.Separator/>

            <For each={propsRegistry.list()}>{(p) => (
                <Menu.Text
                    id={p.type}
                    name={p.displayName(intl)}
                    onClick={() => props.onTypeSelected(p)}
                />
            )}</For>
        </>
    )
}

const PropertyMenu = (props: Props) => {
    const intl = useIntl()
    let currentPropertyName = props.propertyName

    const deleteText = intl.formatMessage({
        id: 'PropertyMenu.Delete',
        defaultMessage: 'Delete',
    })

    return (
        <Menu>
            <Menu.TextInput
                initialValue={props.propertyName}
                onConfirmValue={(n) => {
                    props.onTypeAndNameChanged(props.propertyType, n)
                    currentPropertyName = n
                }}
                onValueChanged={(n) => {
                    currentPropertyName = n
                }}
            />
            <Menu.SubMenu
                id='type'
                name={typeMenuTitle(intl, props.propertyType)}

                // 'auto' hangs the list off whichever end of the option has
                // more room and caps its height there: the type list is longer
                // than a low-standing menu has below it, and without the cap it
                // ran off the screen with no scrollbar to reach the rest.
                position='auto'
            >
                <PropertyTypes
                    label={intl.formatMessage({id: 'PropertyMenu.changeType', defaultMessage: 'Change property type'})}
                    onTypeSelected={(type: PropertyType) => props.onTypeAndNameChanged(type, currentPropertyName)}
                />
            </Menu.SubMenu>
            <Menu.Text
                id='delete'
                name={deleteText}
                onClick={() => props.onDelete(props.propertyId)}
            />
        </Menu>
    )
}

export default PropertyMenu
