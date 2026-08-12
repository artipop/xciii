import {ContentBlock} from './contentBlock'
import {Block, createBlock} from './block'

type TextBlock = ContentBlock & {
    type: 'text'
}

function createTextBlock(block?: Block): TextBlock {
    return {
        ...createBlock(block),
        type: 'text',
    }
}

export {type TextBlock, createTextBlock}
