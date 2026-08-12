import {Block, createBlock} from './block'

type IContentBlockWithCords = {
    block: Block
    cords: {x: number, y?: number, z?: number}
}

type ContentBlock = Block

const createContentBlock = createBlock

export {type ContentBlock, type IContentBlockWithCords, createContentBlock}
