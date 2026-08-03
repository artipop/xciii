// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {DatePropertyType} from '../../properties/types'

import {IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import CheckIcon from '../../widgets/icons/check'

import propsRegistry from '../../properties'

type Props = {
    properties: readonly IPropertyTemplate[]
    activeView: BoardView
    dateDisplayPropertyName?: string
}

const ViewHeaderDisplayByMenu = (props: Props) => {
    const intl = useIntl()

    const createdDateName = propsRegistry.get('createdTime').displayName(intl)

    const getDateProperties = (): IPropertyTemplate[] => {
        return props.properties?.filter((o: IPropertyTemplate) => propsRegistry.get(o.type) instanceof DatePropertyType)
    }

    return (
        <MenuWrapper
            menu={
                <Menu>
                    <For each={getDateProperties()}>
                        {(date: IPropertyTemplate) => (
                            <Menu.Text
                                id={date.id}
                                name={date.name}
                                rightIcon={props.activeView.fields.dateDisplayPropertyId === date.id ? <CheckIcon/> : undefined}
                                onClick={(id) => {
                                    if (props.activeView.fields.dateDisplayPropertyId === id) {
                                        return
                                    }
                                    mutator.changeViewDateDisplayPropertyId(props.activeView.boardId, props.activeView.id, props.activeView.fields.dateDisplayPropertyId, id)
                                }}
                            />
                        )}
                    </For>
                    <Show when={getDateProperties().length === 0}>
                        <Menu.Text
                            id={'createdDate'}
                            name={createdDateName}
                            rightIcon={<CheckIcon/>}
                            onClick={() => {}}
                        />
                    </Show>
                </Menu>
            }
        >
            <Button>
                <FormattedMessage
                    id='ViewHeader.display-by'
                    defaultMessage='Display by: {property}'
                    values={{
                        property: (
                            <span
                                style={{color: 'rgb(var(--center-channel-color-rgb))'}}
                                id='displayByLabel'
                            >
                                {props.dateDisplayPropertyName || createdDateName}
                            </span>
                        ),
                    }}
                />
            </Button>
        </MenuWrapper>
    )
}

export default ViewHeaderDisplayByMenu
