import {For, Show} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Constants} from '../../constants'
import {IPropertyTemplate} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'
import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'

type Props = {
    properties: readonly IPropertyTemplate[]
    activeView: BoardView
}
const ViewHeaderPropertiesMenu = (props: Props) => {
    const intl = useIntl()
    const visiblePropertyIds = () => props.activeView.fields.visiblePropertyIds
    const canShowBadges = () => {
        const viewType = props.activeView.fields.viewType
        return viewType === 'board' || viewType === 'gallery' || viewType === 'calendar'
    }

    const toggleVisibility = (propertyId: string) => {
        let newVisiblePropertyIds = []
        if (visiblePropertyIds().includes(propertyId)) {
            newVisiblePropertyIds = visiblePropertyIds().filter((o: string) => o !== propertyId)
        } else {
            newVisiblePropertyIds = [...visiblePropertyIds(), propertyId]
        }
        mutator.changeViewVisibleProperties(props.activeView.boardId, props.activeView.id, visiblePropertyIds(), newVisiblePropertyIds)
    }

    return (
        <MenuWrapper
            label={intl.formatMessage({id: 'ViewHeader.properties-menu', defaultMessage: 'Properties menu'})}
            menu={
                <Menu>
                    <Show when={props.activeView.fields.viewType === 'gallery'}>
                        <Menu.Switch
                            id={Constants.titleColumnId}
                            name={intl.formatMessage({id: 'default-properties.title', defaultMessage: 'Title'})}
                            isOn={visiblePropertyIds().includes(Constants.titleColumnId)}
                            suppressItemClicked={true}
                            onClick={toggleVisibility}
                        />
                    </Show>
                    <For each={props.properties}>
                        {(option: IPropertyTemplate) => (
                            <Menu.Switch
                                id={option.id}
                                name={option.name}
                                isOn={visiblePropertyIds().includes(option.id)}
                                suppressItemClicked={true}
                                onClick={toggleVisibility}
                            />
                        )}
                    </For>
                    <Show when={canShowBadges()}>
                        <Menu.Switch
                            id={Constants.badgesColumnId}
                            name={intl.formatMessage({id: 'default-properties.badges', defaultMessage: 'Comments and description'})}
                            isOn={visiblePropertyIds().includes(Constants.badgesColumnId)}
                            suppressItemClicked={true}
                            onClick={toggleVisibility}
                        />
                    </Show>
                </Menu>
            }
        >
            <Button>
                <FormattedMessage
                    id='ViewHeader.properties'
                    defaultMessage='Properties'
                />
            </Button>
        </MenuWrapper>
    )
}

export default ViewHeaderPropertiesMenu
