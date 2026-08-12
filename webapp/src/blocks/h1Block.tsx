import {ContentBlock} from './contentBlock'
import {Block, createBlock} from './block'

type H1Block = ContentBlock & {
    type: 'h1'
}

function createH1Block(block?: Block): H1Block {
    return {
        ...createBlock(block),
        type: 'h1',
    }
}

export {type H1Block, createH1Block}

