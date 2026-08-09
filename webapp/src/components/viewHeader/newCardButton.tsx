// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import ButtonWithMenu from '../../widgets/buttons/buttonWithMenu'
import AddIcon from '../../widgets/icons/add'
import Menu from '../../widgets/menu'
import {useAppSelector} from '../../store/hooks'
import {getCurrentBoardTemplates} from '../../store/cards'
import {getCurrentView} from '../../store/views'
import RootPortal from '../rootPortal'
import PlanningDialog, {isPlanningAvailable} from '../acp/planningDialog'

import NewCardButtonTemplateItem from './newCardButtonTemplateItem'
import EmptyCardButton from './emptyCardButton'

type Props = {

    // The board a conversation with an agent may leave cards on. It is the only
    // reason this button knows about a board at all.
    board: Board
    addCard: () => void
    addCardFromTemplate: (cardTemplateId: string) => void
    addCardTemplate: () => void
    editCardTemplate: (cardTemplateId: string) => void
}

const NewCardButton = (props: Props): JSX.Element => {
    const cardTemplates = useAppSelector(getCurrentBoardTemplates)
    const currentView = useAppSelector(getCurrentView)
    const intl = useIntl()

    // Talking a task through with an agent is a way of making cards, so it is
    // here rather than in the board's menu, where it used to sit among the
    // settings. What comes out of the conversation are cards on this board.
    const [planning, setPlanning] = createSignal(false)

    const defaultTemplateID = () => {
        const id = currentView().fields.defaultTemplateId
        return cardTemplates().some((t) => t.id === id) ? id : ''
    }

    const button = (
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

                <Show when={isPlanningAvailable()}>
                    <Menu.Separator/>
                    <Menu.Text
                        id='planTask'
                        name={intl.formatMessage({id: 'ViewHeader.plan-task', defaultMessage: 'Talk it over with an agent…'})}
                        onClick={() => setPlanning(true)}
                    />
                </Show>
            </Menu>
        </ButtonWithMenu>
    )

    return (
        <>
            {button}

            {/* Out of the header's flex row entirely: a wrapper around the
                button to hang a dialog off would be a layout change to pay for
                a dialog that is usually not there. */}
            <Show when={planning()}>
                <RootPortal>
                    <PlanningDialog
                        board={props.board}
                        onClose={() => setPlanning(false)}
                    />
                </RootPortal>
            </Show>
        </>
    )
}

export default NewCardButton
