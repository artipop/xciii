import {Block, createBlock} from './block'

type CommentBlock = Block & {
    type: 'comment'
}

function createCommentBlock(block?: Block): CommentBlock {
    return {
        ...createBlock(block),
        type: 'comment',
    }
}

export {type CommentBlock, createCommentBlock}
