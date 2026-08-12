import {For, Show} from 'solid-js'

import {useIntl, IntlShape} from '../../intl'

import {IContentBlockWithCords, ContentBlock as ContentBlockType} from '../../blocks/contentBlock'
import {Card} from '../../blocks/card'
import {createTextBlock} from '../../blocks/textBlock'
import {Block} from '../../blocks/block'
import mutator from '../../mutator'
import octoClient from '../../octoClient'
import {useSortableWithGrip} from '../../hooks/sortable'

import ContentBlock from '../contentBlock'
import {MarkdownEditor} from '../markdownEditor'

import AddDescriptionTourStep from '../onboardingTour/addDescription/add_description'

import {dragAndDropRearrange} from './cardDetailContentsUtility'

export type Position = 'left' | 'right' | 'above' | 'below' | 'aboveRow' | 'belowRow'

type Props = {
    id?: string
    card: Card
    contents: Array<ContentBlockType|ContentBlockType[]>
    readonly: boolean
}

async function addTextBlock(card: Card, intl: IntlShape, text: string): Promise<Block> {
    const block = createTextBlock()
    block.parentId = card.id
    block.boardId = card.boardId
    block.title = text

    const description = intl.formatMessage({id: 'CardDetail.addCardText', defaultMessage: 'add card text'})

    const afterRedo = async (newBlock: Block) => {
        const contentOrder = card.fields.contentOrder.slice()
        contentOrder.push(newBlock.id)
        await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
    }

    const beforeUndo = async () => {
        const contentOrder = card.fields.contentOrder.slice()
        await octoClient.patchBlock(card.boardId, card.id, {updatedFields: {contentOrder}})
    }

    return mutator.insertBlock(block.boardId, block, description, afterRedo, beforeUndo)
}

function moveBlock(card: Card, srcBlock: IContentBlockWithCords, dstBlock: IContentBlockWithCords, intl: IntlShape, moveTo: Position): void {
    const contentOrder: Array<string|string[]> = []
    if (card.fields.contentOrder) {
        for (const contentId of card.fields.contentOrder) {
            if (typeof contentId === 'string') {
                contentOrder.push(contentId)
            } else {
                contentOrder.push(contentId.slice())
            }
        }
    }

    const srcBlockId = srcBlock.block.id
    const dstBlockId = dstBlock.block.id

    const srcBlockX = srcBlock.cords.x
    const dstBlockX = dstBlock.cords.x

    const srcBlockY = (srcBlock.cords.y || srcBlock.cords.y === 0) && (srcBlock.cords.y > -1) ? srcBlock.cords.y : -1
    const dstBlockY = (dstBlock.cords.y || dstBlock.cords.y === 0) && (dstBlock.cords.y > -1) ? dstBlock.cords.y : -1

    if (srcBlockId === dstBlockId) {
        return
    }

    const newContentOrder = dragAndDropRearrange({contentOrder, srcBlockId, srcBlockX, srcBlockY, dstBlockId, dstBlockX, dstBlockY, moveTo})

    mutator.performAsUndoGroup(async () => {
        const description = intl.formatMessage({id: 'CardDetail.moveContent', defaultMessage: 'Move card content'})
        await mutator.changeCardContentOrder(card.boardId, card.id, card.fields.contentOrder, newContentOrder, description)
    })
}

type ContentBlockWithDragAndDropProps = {
    block: ContentBlockType | ContentBlockType[]
    x: number
    card: Card
    contents: Array<ContentBlockType|ContentBlockType[]>
    intl: IntlShape
    readonly: boolean
}

const ContentBlockWithDragAndDrop = (props: ContentBlockWithDragAndDropProps) => {
    const [, isOver,, itemRef] = useSortableWithGrip('content', () => ({block: props.block, cords: {x: props.x}}), () => true, (src, dst) => moveBlock(props.card, src, dst, props.intl, 'aboveRow'))
    const [, isOver2,, itemRef2] = useSortableWithGrip('content', () => ({block: props.block, cords: {x: props.x}}), () => true, (src, dst) => moveBlock(props.card, src, dst, props.intl, 'belowRow'))

    return (
        <Show
            when={Array.isArray(props.block)}
            fallback={
                <div>
                    <div
                        ref={itemRef}
                        class={`addToRow ${isOver() ? 'dragover' : ''}`}
                        style={{width: '94%', height: '10px', 'margin-left': '48px'}}
                    />
                    <ContentBlock
                        block={props.block as ContentBlockType}
                        card={props.card}
                        readonly={props.readonly}
                        onDrop={(src, dst, moveTo) => moveBlock(props.card, src, dst, props.intl, moveTo)}
                        cords={{x: props.x}}
                    />
                    <Show when={props.x === props.contents.length - 1}>
                        <div
                            ref={itemRef2}
                            class={`addToRow ${isOver2() ? 'dragover' : ''}`}
                            style={{width: '94%', height: '10px', 'margin-left': '48px'}}
                        />
                    </Show>
                </div>
            }
        >
            <div>
                <div
                    ref={itemRef}
                    class={`addToRow ${isOver() ? 'dragover' : ''}`}
                    style={{width: '94%', height: '10px', 'margin-left': '48px'}}
                />
                <div
                    style={{display: 'flex'}}
                >

                    <For each={props.block as ContentBlockType[]}>
                        {(b, y) => (
                            <ContentBlock
                                block={b}
                                card={props.card}
                                readonly={props.readonly}
                                width={(1 / (props.block as ContentBlockType[]).length) * 100}
                                onDrop={(src, dst, moveTo) => moveBlock(props.card, src, dst, props.intl, moveTo)}
                                cords={{x: props.x, y: y()}}
                            />
                        )}
                    </For>
                </div>
                <Show when={props.x === props.contents.length - 1}>
                    <div
                        ref={itemRef2}
                        class={`addToRow ${isOver2() ? 'dragover' : ''}`}
                        style={{width: '94%', height: '10px', 'margin-left': '48px'}}
                    />
                </Show>
            </div>
        </Show>
    )
}

const CardDetailContents = (props: Props) => {
    const intl = useIntl()
    return (
        <Show
            when={props.contents.length}
            fallback={
                <div class='octo-content CardDetailContents'>
                    <div class='octo-block'>
                        <div class='octo-block-margin'/>
                        <Show when={!props.readonly}>
                            <MarkdownEditor
                                id={props.id}
                                text=''
                                placeholderText='Add a description...'
                                onBlur={(text) => {
                                    if (text) {
                                        addTextBlock(props.card, intl, text)
                                    }
                                }}
                            />
                        </Show>
                    </div>
                </div>
            }
        >
            <div class='octo-content'>
                <For each={props.contents}>
                    {(block, x) => (
                        <>
                            <ContentBlockWithDragAndDrop
                                block={block}
                                x={x()}
                                card={props.card}
                                contents={props.contents}
                                intl={intl}
                                readonly={props.readonly}
                            />
                            <Show when={x() === 0}>
                                <AddDescriptionTourStep/>
                            </Show>
                        </>
                    )}
                </For>
            </div>
        </Show>
    )
}

export default CardDetailContents
