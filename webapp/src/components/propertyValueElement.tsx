// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {JSX} from 'solid-js'
import {Dynamic} from 'solid-js/web'

import {Board, IPropertyTemplate} from '../blocks/board'
import {Card} from '../blocks/card'

import propsRegistry from '../properties'

type Props = {
    board: Board
    readOnly: boolean
    card: Card
    propertyTemplate: IPropertyTemplate
    showEmptyPlaceholder: boolean
}

const PropertyValueElement = (props: Props): JSX.Element => {
    // Read on use, not destructured once: a value edited here or arriving over
    // the WebSocket has to reach the editor, and a column whose type changes
    // has to swap the editor with it.
    const propertyValue = () => props.card.fields.properties[props.propertyTemplate.id] ?? ''
    const property = () => propsRegistry.get(props.propertyTemplate.type)

    return (
        <Dynamic
            component={property().Editor}
            property={property()}
            card={props.card}
            board={props.board}
            readOnly={props.readOnly}
            showEmptyPlaceholder={props.showEmptyPlaceholder}
            propertyTemplate={props.propertyTemplate}
            propertyValue={propertyValue()}
        />
    )
}

export default PropertyValueElement
