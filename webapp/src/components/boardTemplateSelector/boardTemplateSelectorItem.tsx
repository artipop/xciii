import {Show, createSignal} from 'solid-js'

import {useIntl} from '../../intl'

import {Board} from '../../blocks/board'
import CompassIcon from '../../widgets/icons/compassIcon'
import IconButton from '../../widgets/buttons/iconButton'
import DeleteIcon from '../../widgets/icons/delete'
import EditIcon from '../../widgets/icons/edit'
import DeleteBoardDialog from '../sidebar/deleteBoardDialog'

import BoardPermissionGate from '../permissions/boardPermissionGate'

import './boardTemplateSelectorItem.scss'
import {Constants, Permission} from '../../constants'

type Props = {
    isActive: boolean
    template: Board
    onSelect: (template: Board) => void
    onDelete: (template: Board) => void

    // The whole template, not its id: editing one is about what it carries —
    // its columns, its routes, what it asks for — and that is read off the
    // board itself rather than fetched again.
    onEdit: (template: Board) => void
}

const BoardTemplateSelectorItem = (props: Props) => {
    const intl = useIntl()
    const [deleteOpen, setDeleteOpen] = createSignal<boolean>(false)
    const onClickHandler = () => {
        props.onSelect(props.template)
    }
    const onEditHandler = (e: MouseEvent) => {
        e.stopPropagation()
        props.onEdit(props.template)
    }

    return (
        <div
            class={props.isActive ? 'BoardTemplateSelectorItem active' : 'BoardTemplateSelectorItem'}
            onClick={onClickHandler}
        >
            <span class='template-icon'>{props.template.icon || <CompassIcon icon='product-boards'/>}</span>
            <span class='template-name'>{props.template.title || intl.formatMessage({id: 'View.NewTemplateTitle', defaultMessage: 'Untitled'})}</span>

            {/* don't show template menu options for default templates */}
            <Show when={props.template.createdBy !== Constants.SystemUserID}>
                <div class='actions'>
                    <BoardPermissionGate
                        boardId={props.template.id}
                        teamId={props.template.teamId}
                        permissions={[Permission.DeleteBoard]}
                    >
                        <IconButton
                            icon={<DeleteIcon/>}
                            title={intl.formatMessage({id: 'BoardTemplateSelector.delete-template', defaultMessage: 'Delete'})}
                            onClick={(e: MouseEvent) => {
                                e.stopPropagation()
                                setDeleteOpen(true)
                            }}
                        />
                    </BoardPermissionGate>
                    <BoardPermissionGate
                        boardId={props.template.id}
                        teamId={props.template.teamId}
                        permissions={[Permission.ManageBoardCards, Permission.ManageBoardProperties]}
                    >
                        <IconButton
                            icon={<EditIcon/>}
                            title={intl.formatMessage({id: 'BoardTemplateSelector.edit-template', defaultMessage: 'Edit'})}
                            onClick={onEditHandler}
                        />
                    </BoardPermissionGate>
                </div>
            </Show>
            <Show when={deleteOpen()}>
                <DeleteBoardDialog
                    boardTitle={props.template.title}
                    onClose={() => setDeleteOpen(false)}
                    isTemplate={true}
                    onDelete={async () => {
                        props.onDelete(props.template)
                    }}
                />
            </Show>
        </div>
    )
}

export default BoardTemplateSelectorItem
