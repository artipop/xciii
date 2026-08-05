// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useIntl} from '../../intl'

import mutator from '../../mutator'
import {Card} from '../../blocks/card'
import IconButton from '../../widgets/buttons/iconButton'
import DeleteIcon from '../../widgets/icons/delete'
import EditIcon from '../../widgets/icons/edit'
import OptionsIcon from '../../widgets/icons/options'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import CheckIcon from '../../widgets/icons/check'
import {useAppSelector} from '../../store/hooks'
import {getCurrentView} from '../../store/views'
import {getCurrentBoardId} from '../../store/boards'

type Props = {
    cardTemplate: Card
    addCardFromTemplate: (cardTemplateId: string) => void
    editCardTemplate: (cardTemplateId: string) => void
}

const NewCardButtonTemplateItem = (props: Props) => {
    const currentView = useAppSelector(getCurrentView)
    const intl = useIntl()
    const displayName = () => props.cardTemplate.title || intl.formatMessage({id: 'ViewHeader.untitled', defaultMessage: 'Untitled'})
    const isDefaultTemplate = () => currentView().fields.defaultTemplateId === props.cardTemplate.id
    const boardId = useAppSelector(getCurrentBoardId)

    return (
        <Menu.Text
            id={props.cardTemplate.id}
            name={displayName()}
            icon={<div class='Icon'>{props.cardTemplate.fields.icon}</div>}
            className={isDefaultTemplate() ? 'bold-menu-text' : ''}
            onClick={() => {
                props.addCardFromTemplate(props.cardTemplate.id)
            }}
            rightIcon={
                <MenuWrapper
                    stopPropagationOnToggle={true}
                    menu={
                        <Menu position='left'>
                            <Menu.Text
                                icon={<CheckIcon/>}
                                id='default'
                                name={intl.formatMessage({id: 'ViewHeader.set-default-template', defaultMessage: 'Set as default'})}
                                onClick={async () => {
                                    await mutator.setDefaultTemplate(boardId(), currentView().id, currentView().fields.defaultTemplateId, props.cardTemplate.id)
                                }}
                            />
                            <Menu.Text
                                icon={<EditIcon/>}
                                id='edit'
                                name={intl.formatMessage({id: 'ViewHeader.edit-template', defaultMessage: 'Edit'})}
                                onClick={() => {
                                    props.editCardTemplate(props.cardTemplate.id)
                                }}
                            />
                            <Menu.Text
                                icon={<DeleteIcon/>}
                                id='delete'
                                name={intl.formatMessage({id: 'ViewHeader.delete-template', defaultMessage: 'Delete'})}
                                onClick={async () => {
                                    await mutator.performAsUndoGroup(async () => {
                                        if (currentView().fields.defaultTemplateId === props.cardTemplate.id) {
                                            await mutator.clearDefaultTemplate(boardId(), currentView().id, currentView().fields.defaultTemplateId)
                                        }
                                        await mutator.deleteBlock(props.cardTemplate, 'delete card template')
                                    })
                                }}
                            />
                        </Menu>
                    }
                >
                    <IconButton icon={<OptionsIcon/>}/>
                </MenuWrapper>
            }
        />
    )
}

export default NewCardButtonTemplateItem
