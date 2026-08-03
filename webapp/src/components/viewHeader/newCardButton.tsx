// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import ButtonWithMenu from '../../widgets/buttons/buttonWithMenu'
import AddIcon from '../../widgets/icons/add'
import Menu from '../../widgets/menu'
import {useAppSelector} from '../../store/hooks'
import {getCurrentBoardTemplates} from '../../store/cards'
import {getCurrentView} from '../../store/views'

import NewCardButtonTemplateItem from './newCardButtonTemplateItem'
import EmptyCardButton from './emptyCardButton'

type Props = {
    addCard: () => void
    addCardFromTemplate: (cardTemplateId: string) => void
    addCardTemplate: () => void
    editCardTemplate: (cardTemplateId: string) => void
}

const NewCardButton = (props: Props): JSX.Element => {
    const cardTemplates = useAppSelector(getCurrentBoardTemplates)
    const currentView = useAppSelector(getCurrentView)
    const intl = useIntl()

    const defaultTemplateID = () => {
        const id = currentView().fields.defaultTemplateId
        return cardTemplates().some((t) => t.id === id) ? id : ''
    }

    return (
        <ButtonWithMenu
            onClick={() => {
                if (defaultTemplateID()) {
                    props.addCardFromTemplate(defaultTemplateID())
                } else {
                    props.addCard()
                }
            }}
            text={(
                <FormattedMessage
                    id='ViewHeader.new'
                    defaultMessage='New'
                />
            )}
        >
            <Menu position='left'>
                <Show when={cardTemplates().length > 0}>
                    <Menu.Label>
                        <b>
                            <FormattedMessage
                                id='ViewHeader.select-a-template'
                                defaultMessage='Select a template'
                            />
                        </b>
                    </Menu.Label>

                    <Menu.Separator/>
                </Show>

                <For each={cardTemplates()}>
                    {(cardTemplate) => (
                        <NewCardButtonTemplateItem
                            cardTemplate={cardTemplate}
                            addCardFromTemplate={props.addCardFromTemplate}
                            editCardTemplate={props.editCardTemplate}
                        />
                    )}
                </For>

                <EmptyCardButton
                    addCard={props.addCard}
                />

                <Menu.Text
                    icon={<AddIcon/>}
                    id='add-template'
                    name={intl.formatMessage({id: 'ViewHeader.add-template', defaultMessage: 'New template'})}
                    onClick={() => props.addCardTemplate()}
                />
            </Menu>
        </ButtonWithMenu>
    )
}

export default NewCardButton
