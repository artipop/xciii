import {InlineStrategy} from '../pluginStrategy'
import findRangesWithRegex from '../utils/findRangesWithRegex'

const createULDelimiterStyleStrategy = (): InlineStrategy => {
    const ulDelimiterRegex = /^\* /g

    return {
        style: 'UL-DELIMITER',
        findStyleRanges: (text) => {
            const ulDelimiterRanges = findRangesWithRegex(text, ulDelimiterRegex)
            return ulDelimiterRanges
        },
        styles: {
            fontWeight: 'bold',
        },
    }
}

export default createULDelimiterStyleStrategy
