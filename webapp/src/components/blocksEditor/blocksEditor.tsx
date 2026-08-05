// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, Show, createMemo, createSignal} from 'solid-js'

import {SortableProvider} from '../../hooks/sortable'

import Editor from './editor'
import {BlockData} from './blocks/types'
import BlockContent from './blockContent'
import * as registry from './blocks'

type Props = {
    boardId?: string
    onBlockCreated: (block: BlockData, afterBlock?: BlockData) => Promise<BlockData|null>
    onBlockModified: (block: BlockData) => Promise<BlockData|null>
    onBlockMoved: (block: BlockData, beforeBlock: BlockData|null, afterBlock: BlockData|null) => Promise<void>
    blocks: BlockData[]
}

function BlocksEditor(props: Props) {
    const [nextType, setNextType] = createSignal<string>('')
    const [editing, setEditing] = createSignal<BlockData|null>(null)
    const [afterBlock, setAfterBlock] = createSignal<BlockData|null>(null)
    const contentOrder = createMemo(() => props.blocks.filter((b) => b.id).map((b) => b.id!))
    return (
        <div
            class='BlocksEditor'
            onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'ArrowUp') {
                    if (editing() === null) {
                        if (afterBlock() === null) {
                            setEditing(props.blocks[props.blocks.length - 1] || null)
                        } else {
                            setEditing(afterBlock())
                        }
                        setAfterBlock(null)
                        return
                    }
                    let prevBlock = null
                    for (const b of props.blocks) {
                        if (editing()?.id === b.id) {
                            break
                        }
                        const blockType = registry.get(b.contentType)
                        if (blockType.editable) {
                            prevBlock = b
                        }
                    }
                    if (prevBlock) {
                        setEditing(prevBlock)
                        setAfterBlock(null)
                    }
                } else if (e.key === 'ArrowDown') {
                    let currentBlock = editing()
                    if (currentBlock === null) {
                        currentBlock = afterBlock()
                    }
                    if (currentBlock === null) {
                        return
                    }

                    let nextBlock = null
                    let breakNext = false
                    for (const b of props.blocks) {
                        if (breakNext) {
                            const blockType = registry.get(b.contentType)
                            if (blockType.editable) {
                                nextBlock = b
                                break
                            }
                        }
                        if (currentBlock.id === b.id) {
                            breakNext = true
                        }
                    }
                    setEditing(nextBlock)
                    setAfterBlock(null)
                }
            }}
        >
            <SortableProvider>
                <For each={props.blocks}>
                    {(d) => (
                        <div>
                            <BlockContent
                                block={d}
                                editing={editing()}
                                setEditing={(block) => {
                                    setEditing(block)
                                    setAfterBlock(null)
                                }}
                                contentOrder={contentOrder()}
                                setAfterBlock={setAfterBlock}
                                onSave={async (b) => {
                                    const newBlock = await props.onBlockModified(b)
                                    setNextType(registry.get(b.contentType).nextType || '')
                                    setAfterBlock(newBlock)
                                    return newBlock
                                }}
                                onMove={props.onBlockMoved}
                            />
                            <Show when={afterBlock() && afterBlock()!.id === d.id}>
                                <Editor
                                    initialValue=''
                                    initialContentType={nextType()}
                                    onSave={async (b) => {
                                        const newBlock = await props.onBlockCreated(b, afterBlock()!)
                                        setNextType(registry.get(b.contentType).nextType || '')
                                        setAfterBlock(newBlock)
                                        return newBlock
                                    }}
                                />
                            </Show>
                        </div>
                    )}
                </For>
                <Show when={!editing() && !afterBlock()}>
                    <Editor onSave={props.onBlockCreated}/>
                </Show>
            </SortableProvider>
        </div>
    )
}

export default BlocksEditor
