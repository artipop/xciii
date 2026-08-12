import {For} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, IntlShape, useIntl} from '../../intl'

import {BlockTypes} from '../../blocks/block'
import {Utils} from '../../utils'
import Button from '../../widgets/buttons/button'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'

import {contentRegistry} from '../content/contentRegistry'

import {useCardDetailContext} from './cardDetailContext'

function AddContentMenuItem(props: {intl: IntlShape, type: BlockTypes}): JSX.Element {
    const handler = contentRegistry.getHandler(props.type)
    const cardDetail = useCardDetailContext()
    const addElement = async () => {
        if (!handler) {
            return
        }
        const {card} = cardDetail
        const index = card.fields.contentOrder.length
        cardDetail.addBlock(handler, index, false)
    }

    if (!handler) {
        Utils.logError(`AddContentMenuItem, unknown content type: ${props.type}`)
        return <></>
    }

    return (
        <Menu.Text
            id={props.type}
            name={handler.getDisplayText(props.intl)}
            icon={handler.getIcon()}
            onClick={addElement}
        />
    )
}

const CardDetailContentsMenu = () => {
    const intl = useIntl()
    return (
        <div class='CardDetailContentsMenu content add-content'>
            <MenuWrapper
                menu={
                    <Menu position='top'>
                        <For each={contentRegistry.contentTypes}>
                            {(type) => (
                                <AddContentMenuItem
                                    intl={intl}
                                    type={type}
                                />
                            )}
                        </For>
                    </Menu>
                }
            >
                <Button>
                    <FormattedMessage
                        id='CardDetail.add-content'
                        defaultMessage='Add content'
                    />
                </Button>
            </MenuWrapper>
        </div>
    )
}

export default CardDetailContentsMenu
