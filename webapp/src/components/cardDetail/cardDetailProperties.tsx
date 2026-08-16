import {For, Show, createEffect, createSignal} from 'solid-js'

import {FormattedMessage, useIntl} from '../../intl'

import {Board, IPropertyTemplate} from '../../blocks/board'
import {Card} from '../../blocks/card'
import {BoardView} from '../../blocks/boardView'

import mutator from '../../mutator'
import Button from '../../widgets/buttons/button'
import MenuWrapper from '../../widgets/menuWrapper'
import PropertyMenu, {PropertyTypes} from '../../widgets/propertyMenu'

import Calculations from '../calculations/calculations'
import PropertyValueElement from '../propertyValueElement'
import ConfirmationDialogBox, {ConfirmationDialogBoxProps} from '../confirmationDialogBox'
import {sendFlashMessage} from '../flashMessages'
import Menu from '../../widgets/menu'
import {IDType, Utils} from '../../utils'
import AddPropertiesTourStep from '../onboardingTour/addProperties/add_properties'
import {Permission} from '../../constants'
import {useHasCurrentBoardPermissions} from '../../hooks/permissions'
import propRegistry from '../../properties'
import {PropertyType} from '../../properties/types'

import {boardBranchProperty} from '../acp/automation'
import {cardAgentState} from '../acp/cardAgentState'
import {findWorkdirProperty} from '../acp/workdirSync'

type Props = {
    board: Board
    card: Card
    cards: Card[]
    activeView: BoardView
    views: BoardView[]
    readonly: boolean
}

const CardDetailProperties = (props: Props) => {
    const [newTemplateId, setNewTemplateId] = createSignal('')
    const canEditBoardProperties = useHasCurrentBoardPermissions([Permission.ManageBoardProperties])
    const canEditBoardCards = useHasCurrentBoardPermissions([Permission.ManageBoardCards])
    const intl = useIntl()

    // The branch field is the machine's record — where the card's work lives —
    // and the card knows *what kind* of place that is. The board records which
    // property it is (xciiiBranchProperty); the card's own state says whether
    // its workspace is a copy or a branch in the folder. The stamp under the
    // title already names its line after the mode, and a field under it saying
    // «Ветка» over the same value read as the setting not having taken.
    const branchPropertyId = () => boardBranchProperty(props.board)
    const agentState = () => cardAgentState(props.card.id)()
    const isBranchProperty = (t: IPropertyTemplate) => t.id !== '' && t.id === branchPropertyId()
    const branchLabel = (t: IPropertyTemplate) => {
        if (agentState().workMode === 'worktree') {
            return intl.formatMessage({id: 'CardDetail.worktree-property', defaultMessage: 'Worktree'})
        }
        return t.name
    }

    // The folder stops being a choice once the card has a workspace. Work on a
    // card lives in one place — a copy and a branch, or a branch in the folder
    // itself — and it was claimed under the folder the card named then: moving
    // the card to another folder afterwards does not move the work, it only
    // makes the card describe somewhere the work is not. The claim is the fact
    // to read, not the column the card stands in, because that is exactly what
    // "работа началась" means here — a folder was taken for this card.
    //
    // Refusing it in the one place a person changes it, rather than refusing
    // later and further away: an agent standing on a card whose field says one
    // folder and whose branch is in another is a state nobody can read back.
    const workdirProperty = () => findWorkdirProperty(props.board, props.board.cardProperties)
    const workdirLocked = () => Boolean(agentState().workMode)
    const isWorkdirProperty = (t: IPropertyTemplate) => t.id !== '' && t.id === workdirProperty()?.id
    const lockedFolderName = () => {
        const property = workdirProperty()
        const value = property && props.card.fields.properties[property.id]
        const optionId = Array.isArray(value) ? value[0] : value
        return property?.options.find((o) => o.id === optionId)?.value || ''
    }

    createEffect(() => {
        const newProperty = props.board.cardProperties.find((property) => property.id === newTemplateId())
        if (newProperty) {
            setNewTemplateId('')
        }
    })

    const [confirmationDialogBox, setConfirmationDialogBox] = createSignal<ConfirmationDialogBoxProps>({heading: '', onConfirm: () => {}, onClose: () => {}})
    const [showConfirmationDialog, setShowConfirmationDialog] = createSignal<boolean>(false)

    function onPropertyChangeSetAndOpenConfirmationDialog(newType: PropertyType, newName: string, propertyTemplate: IPropertyTemplate) {
        const {board, cards} = props
        const oldType = propRegistry.get(propertyTemplate.type)

        // do nothing if no change
        if (oldType === newType && propertyTemplate.name === newName) {
            return
        }

        const affectsNumOfCards: string = Calculations.countNotEmpty(cards, propertyTemplate, intl)

        // if only the name has changed, set the property without warning
        if (affectsNumOfCards === '0' || oldType === newType) {
            mutator.changePropertyTypeAndName(board, cards, propertyTemplate, newType.type, newName)
            return
        }

        const subTextString = intl.formatMessage({
            id: 'CardDetailProperty.property-name-change-subtext',
            defaultMessage: 'type from "{oldPropType}" to "{newPropType}"',
        }, {oldPropType: oldType.displayName(intl), newPropType: newType.displayName(intl)})

        setConfirmationDialogBox({
            heading: intl.formatMessage({id: 'CardDetailProperty.confirm-property-type-change', defaultMessage: 'Confirm property type change'}),
            subText: intl.formatMessage({
                id: 'CardDetailProperty.confirm-property-name-change-subtext',
                defaultMessage: 'Are you sure you want to change property "{propertyName}" {customText}? This will affect {numOfCards, plural, one {a value on # card} other {values across # cards}} in this board, and can result in data loss.',
            },
            {
                propertyName: propertyTemplate.name,
                customText: subTextString,
                numOfCards: Number(affectsNumOfCards),
            }),

            confirmButtonText: intl.formatMessage({id: 'CardDetailProperty.property-change-action-button', defaultMessage: 'Change property'}),
            onConfirm: async () => {
                setShowConfirmationDialog(false)
                try {
                    await mutator.changePropertyTypeAndName(board, cards, propertyTemplate, newType.type, newName)
                } catch (err: any) {
                    Utils.logError(`Error Changing Property And Name:${propertyTemplate.name}: ${err?.toString()}`)
                }
                sendFlashMessage({content: intl.formatMessage({id: 'CardDetailProperty.property-changed', defaultMessage: 'Changed property successfully!'}), severity: 'high'})
            },
            onClose: () => setShowConfirmationDialog(false),
        })

        // open confirmation dialog for property type change
        setShowConfirmationDialog(true)
    }

    function onPropertyDeleteSetAndOpenConfirmationDialog(propertyTemplate: IPropertyTemplate) {
        const {board, views, cards} = props

        // set ConfirmationDialogBox Props
        setConfirmationDialogBox({
            heading: intl.formatMessage({id: 'CardDetailProperty.confirm-delete-heading', defaultMessage: 'Confirm delete property'}),
            subText: intl.formatMessage({
                id: 'CardDetailProperty.confirm-delete-subtext',
                defaultMessage: 'Are you sure you want to delete the property "{propertyName}"? Deleting it will delete the property from all cards in this board.',
            },
            {propertyName: propertyTemplate.name}),
            confirmButtonText: intl.formatMessage({id: 'CardDetailProperty.delete-action-button', defaultMessage: 'Delete'}),
            onConfirm: async () => {
                const deletingPropName = propertyTemplate.name
                setShowConfirmationDialog(false)
                try {
                    await mutator.deleteProperty(board, views, cards, propertyTemplate.id)
                    sendFlashMessage({content: intl.formatMessage({id: 'CardDetailProperty.property-deleted', defaultMessage: 'Deleted {propertyName} successfully!'}, {propertyName: deletingPropName}), severity: 'high'})
                } catch (err: any) {
                    Utils.logError(`Error Deleting Property!: Could Not delete Property -" + ${deletingPropName} ${err?.toString()}`)
                }
            },

            onClose: () => setShowConfirmationDialog(false),
        })

        // open confirmation dialog property delete
        setShowConfirmationDialog(true)
    }

    return (
        <div class='octo-propertylist CardDetailProperties'>
            <For each={props.board.cardProperties}>
                {(propertyTemplate: IPropertyTemplate) => (
                    <>
                        <div
                            class='octo-propertyrow'
                        >
                            <Show
                                when={!props.readonly && canEditBoardProperties() && !isBranchProperty(propertyTemplate)}
                                fallback={
                                    <div class='octo-propertyname octo-propertyname--readonly'>
                                        {isBranchProperty(propertyTemplate) ? branchLabel(propertyTemplate) : propertyTemplate.name}
                                    </div>
                                }
                            >
                                <MenuWrapper
                                    isOpen={propertyTemplate.id === newTemplateId()}
                                    menu={
                                        <PropertyMenu
                                            propertyId={propertyTemplate.id}
                                            propertyName={propertyTemplate.name}
                                            propertyType={propRegistry.get(propertyTemplate.type)}
                                            onTypeAndNameChanged={(newType: PropertyType, newName: string) => onPropertyChangeSetAndOpenConfirmationDialog(newType, newName, propertyTemplate)}
                                            onDelete={() => onPropertyDeleteSetAndOpenConfirmationDialog(propertyTemplate)}
                                        />
                                    }
                                >
                                    <div class='octo-propertyname'><Button>{propertyTemplate.name}</Button></div>
                                </MenuWrapper>
                            </Show>
                            <PropertyValueElement
                                readOnly={props.readonly || !canEditBoardCards() ||
                                isBranchProperty(propertyTemplate) ||
                                (isWorkdirProperty(propertyTemplate) && workdirLocked())}
                                card={props.card}
                                board={props.board}
                                propertyTemplate={propertyTemplate}
                                showEmptyPlaceholder={true}
                            />
                        </div>

                        {/* Under the row rather than beside the value: the row is
                        one line of name and value, and the reason a field
                        cannot be changed is a sentence. */}
                        <Show when={isWorkdirProperty(propertyTemplate) && workdirLocked()}>
                            <div class='octo-propertyhint'>
                                {intl.formatMessage({
                                    id: 'CardDetail.folder-locked',
                                    defaultMessage: 'The card is already working in “{folder}”, where its branch is. For another folder, make a new card.',
                                }, {folder: lockedFolderName()})}
                            </div>
                        </Show>
                    </>
                )}
            </For>

            <Show when={showConfirmationDialog()}>
                <ConfirmationDialogBox
                    dialogBox={confirmationDialogBox()}
                />
            </Show>

            <Show when={!props.readonly && canEditBoardProperties()}>
                <div class='octo-propertyname add-property'>
                    <MenuWrapper
                        menu={
                            <Menu>
                                <PropertyTypes
                                    label={intl.formatMessage({id: 'PropertyMenu.selectType', defaultMessage: 'Select property type'})}
                                    onTypeSelected={async (type) => {
                                        const template: IPropertyTemplate = {
                                            id: Utils.createGuid(IDType.BlockID),
                                            name: type.displayName(intl),
                                            type: type.type,
                                            options: [],
                                        }
                                        const templateId = await mutator.insertPropertyTemplate(props.board, props.activeView, -1, template)
                                        setNewTemplateId(templateId)
                                    }}
                                />
                            </Menu>
                        }
                    >
                        <Button>
                            <FormattedMessage
                                id='CardDetail.add-property'
                                defaultMessage='+ Add a property'
                            />
                        </Button>
                    </MenuWrapper>

                    <AddPropertiesTourStep/>
                </div>
            </Show>
        </div>
    )
}

export default CardDetailProperties
