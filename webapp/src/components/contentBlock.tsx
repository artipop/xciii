// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {For, Show, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {useIntl} from '../intl'

import {Card} from '../blocks/card'
import {ContentBlock as ContentBlockType, IContentBlockWithCords} from '../blocks/contentBlock'
import mutator from '../mutator'
import {Utils} from '../utils'
import IconButton from '../widgets/buttons/iconButton'
import AddIcon from '../widgets/icons/add'
import DeleteIcon from '../widgets/icons/delete'
import OptionsIcon from '../widgets/icons/options'
import SortDownIcon from '../widgets/icons/sortDown'
import SortUpIcon from '../widgets/icons/sortUp'
import GripIcon from '../widgets/icons/grip'
import Menu from '../widgets/menu'
import MenuWrapper from '../widgets/menuWrapper'
import {useSortableWithGrip} from '../hooks/sortable'
import {Position} from '../components/cardDetail/cardDetailContents'

import ContentElement from './content/contentElement'
import AddContentMenuItem from './addContentMenuItem'
import {contentRegistry} from './content/contentRegistry'

import './contentBlock.scss'

type Props = {
    block: ContentBlockType
    card: Card
    readonly: boolean
    onDrop: (srctBlock: IContentBlockWithCords, dstBlock: IContentBlockWithCords, position: Position) => void
    width?: number
    cords: {x: number, y?: number, z?: number}
}

const ContentBlock = (props: Props): JSX.Element => {
    const intl = useIntl()
    const item = () => ({block: props.block, cords: props.cords})
    const [, , gripRef, itemRef] = useSortableWithGrip('content', item, () => true, () => {})
    const [, isOver2,, itemRef2] = useSortableWithGrip('content', item, () => true, (src, dst) => props.onDrop(src, dst, 'right'))
    const [, isOver3,, itemRef3] = useSortableWithGrip('content', item, () => true, (src, dst) => props.onDrop(src, dst, 'left'))
    const [menuOpened, setMenuOpened] = createSignal(false)

    const index = () => props.cords.x
    const colIndex = () => ((props.cords.y || props.cords.y === 0) && props.cords.y > -1 ? props.cords.y : -1)
    const contentOrder = (): Array<string|string[]> => {
        const order: Array<string|string[]> = []
        if (props.card.fields.contentOrder) {
            for (const contentId of props.card.fields.contentOrder) {
                if (typeof contentId === 'string') {
                    order.push(contentId)
                } else {
                    order.push(contentId.slice())
                }
            }
        }
        return order
    }

    const className = () => {
        let name = 'ContentBlock octo-block'
        if (menuOpened()) {
            name += ' menuOpened'
        }
        return name
    }

    return (
        <div
            class='rowContents'
            style={{width: props.width + '%'}}
        >
            <div
                ref={itemRef}
                class={className()}
            >
                <div class='octo-block-margin'>
                    <Show when={!props.readonly}>
                        <MenuWrapper
                            onToggle={setMenuOpened}
                            menu={
                                <Menu>
                                    <Show when={index() > 0}>
                                        <Menu.Text
                                            id='moveUp'
                                            name={intl.formatMessage({id: 'ContentBlock.moveUp', defaultMessage: 'Move up'})}
                                            icon={<SortUpIcon/>}
                                            onClick={() => {
                                                const order = contentOrder()
                                                Utils.arrayMove(order, index(), index() - 1)
                                                mutator.changeCardContentOrder(props.card.boardId, props.card.id, props.card.fields.contentOrder, order)
                                            }}
                                        />
                                    </Show>
                                    <Show when={index() < (contentOrder().length - 1)}>
                                        <Menu.Text
                                            id='moveDown'
                                            name={intl.formatMessage({id: 'ContentBlock.moveDown', defaultMessage: 'Move down'})}
                                            icon={<SortDownIcon/>}
                                            onClick={() => {
                                                const order = contentOrder()
                                                Utils.arrayMove(order, index(), index() + 1)
                                                mutator.changeCardContentOrder(props.card.boardId, props.card.id, props.card.fields.contentOrder, order)
                                            }}
                                        />
                                    </Show>
                                    <Menu.SubMenu
                                        id='insertAbove'
                                        name={intl.formatMessage({id: 'ContentBlock.insertAbove', defaultMessage: 'Insert above'})}
                                        icon={<AddIcon/>}
                                        position='top'
                                    >
                                        <For each={contentRegistry.contentTypes}>
                                            {(type) => (
                                                <AddContentMenuItem
                                                    type={type}
                                                    card={props.card}
                                                    cords={props.cords}
                                                />
                                            )}
                                        </For>
                                    </Menu.SubMenu>
                                    <Menu.Text
                                        icon={<DeleteIcon/>}
                                        id='delete'
                                        name={intl.formatMessage({id: 'ContentBlock.Delete', defaultMessage: 'Delete'})}
                                        onClick={() => {
                                            const description = intl.formatMessage({id: 'ContentBlock.DeleteAction', defaultMessage: 'delete'})
                                            const order = contentOrder()

                                            if (colIndex() > -1) {
                                                (order[index()] as string[]).splice(colIndex(), 1)
                                            } else {
                                                order.splice(index(), 1)
                                            }

                                            // If only one item in the row, convert form an array item to normal item ( [item] => item )
                                            if (Array.isArray(order[index()]) && (order[index()] as string[]).length === 1) {
                                                order[index()] = order[index()][0]
                                            }

                                            mutator.performAsUndoGroup(async () => {
                                                await mutator.deleteBlock(props.block, description)
                                                await mutator.changeCardContentOrder(props.card.boardId, props.card.id, props.card.fields.contentOrder, order, description)
                                            })
                                        }}
                                    />
                                </Menu>
                            }
                        >
                            <IconButton icon={<OptionsIcon/>}/>
                        </MenuWrapper>
                        <div
                            ref={gripRef}
                            class='dnd-handle'
                        >
                            <GripIcon/>
                        </div>
                    </Show>
                </div>
                <Show when={!props.cords.y /* That is to say if cords.y === 0 or cords.y === undefined */}>
                    <div
                        ref={itemRef3}
                        class={`addToRow ${isOver3() ? 'dragover' : ''}`}
                        style={{flex: 'none', height: '100%'}}
                    />
                </Show>
                <ContentElement
                    block={props.block}
                    readonly={props.readonly}
                    cords={props.cords}
                />
            </div>
            <div
                ref={itemRef2}
                class={`addToRow ${isOver2() ? 'dragover' : ''}`}
            />
        </div>
    )
}

export default ContentBlock
