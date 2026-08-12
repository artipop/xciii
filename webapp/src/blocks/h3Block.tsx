import {ContentBlock} from './contentBlock'
import {Block, createBlock} from './block'

type H3Block = ContentBlock & {
    type: 'h3'
}

function createH3Block(block?: Block): H3Block {
    return {
        ...createBlock(block),
        type: 'h3',
    }
}

export {type H3Block, createH3Block}

