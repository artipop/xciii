import {InlineStrategy} from '../pluginStrategy'
import findRangesWithRegex from '../utils/findRangesWithRegex'

const createInlineCodeStyleStrategy = (): InlineStrategy => {
    const codeRegex = /(`)([^\n\r`]+?)(`)/g

    return {
        style: 'INLINE-CODE',
        findStyleRanges: (text, blockType) => {
            // Don't allow inline code inside of code blocks
            if (blockType === 'code-block') {
                return []
            }

            const codeRanges = findRangesWithRegex(text, codeRegex)
            return codeRanges
        },
        styles: {
            fontFamily: 'monospace',
        },
    }
}

export default createInlineCodeStyleStrategy
