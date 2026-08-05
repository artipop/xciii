// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {Show, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../intl'

import {BlockIcons} from '../blockIcons'
import {Board} from '../blocks/board'
import mutator from '../mutator'
import Button from '../widgets/buttons/button'
import Editable from '../widgets/editable'
import CompassIcon from '../widgets/icons/compassIcon'
import {Permission} from '../constants'
import {useHasCurrentBoardPermissions} from '../hooks/permissions'

import BoardIconSelector from './boardIconSelector'
import {MarkdownEditor} from './markdownEditor'
import './viewTitle.scss'

type Props = {
    board: Board
    readonly: boolean
}

const ViewTitle = (props: Props) => {
    const [title, setTitle] = createSignal(props.board.title)
    const onEditTitleSave = () => mutator.changeBoardTitle(props.board.id, props.board.title, title())
    const onEditTitleCancel = () => setTitle(props.board.title)
    const onDescriptionBlur = (text: string) => mutator.changeBoardDescription(props.board.id, props.board.id, props.board.description, text)
    const onAddRandomIcon = () => {
        const newIcon = BlockIcons.shared.randomIcon()
        mutator.changeBoardIcon(props.board.id, props.board.icon, newIcon)
    }
    const onShowDescription = () => mutator.showBoardDescription(props.board.id, Boolean(props.board.showDescription), true)
    const onHideDescription = () => mutator.showBoardDescription(props.board.id, Boolean(props.board.showDescription), false)
    const canEditBoardProperties = useHasCurrentBoardPermissions([Permission.ManageBoardProperties])

    const readonly = () => props.readonly || !canEditBoardProperties()

    const intl = useIntl()

    return (
        <div class='ViewTitle'>
            <div class='add-buttons add-visible'>
                <Show when={!readonly() && !props.board.icon}>
                    <Button
                        emphasis='default'
                        size='xsmall'
                        onClick={onAddRandomIcon}
                        icon={
                            <CompassIcon
                                icon='emoticon-outline'
                            />}
                    >
                        <FormattedMessage
                            id='TableComponent.add-icon'
                            defaultMessage='Add icon'
                        />
                    </Button>
                </Show>
                <Show when={!readonly() && props.board.showDescription}>
                    <Button
                        emphasis='default'
                        size='xsmall'
                        onClick={onHideDescription}
                        icon={
                            <CompassIcon
                                icon='eye-off-outline'
                            />}
                    >
                        <FormattedMessage
                            id='ViewTitle.hide-description'
                            defaultMessage='hide description'
                        />
                    </Button>
                </Show>
                <Show when={!readonly() && !props.board.showDescription}>
                    <Button
                        emphasis='default'
                        size='xsmall'
                        onClick={onShowDescription}
                        icon={
                            <CompassIcon
                                icon='eye-outline'
                            />}
                    >
                        <FormattedMessage
                            id='ViewTitle.show-description'
                            defaultMessage='show description'
                        />
                    </Button>
                </Show>
            </div>

            <div class='title'>
                <BoardIconSelector
                    board={props.board}
                    readonly={readonly()}
                />
                <Editable
                    class='title'
                    value={title()}
                    placeholderText={intl.formatMessage({id: 'ViewTitle.untitled-board', defaultMessage: 'Untitled board'})}
                    onChange={(newTitle) => setTitle(newTitle)}
                    saveOnEsc={true}
                    onSave={onEditTitleSave}
                    onCancel={onEditTitleCancel}
                    readonly={readonly()}
                    spellCheck={true}
                />
            </div>

            <Show when={props.board.showDescription}>
                <div class='description'>
                    <MarkdownEditor
                        text={props.board.description}
                        placeholderText='Add a description...'
                        onBlur={onDescriptionBlur}
                        readonly={readonly()}
                    />
                </div>
            </Show>
        </div>
    )
}

export default ViewTitle
