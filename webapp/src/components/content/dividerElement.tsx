import type {JSX} from 'solid-js'

import {DividerBlock, createDividerBlock} from '../../blocks/dividerBlock'
import DividerIcon from '../../widgets/icons/divider'

import {contentRegistry} from './contentRegistry'
import './dividerElement.scss'

const DividerElement = (): JSX.Element => <div class='DividerElement'/>

contentRegistry.registerContentType({
    type: 'divider',
    getDisplayText: (intl) => intl.formatMessage({id: 'ContentBlock.divider', defaultMessage: 'divider'}),
    getIcon: () => <DividerIcon/>,
    createBlock: async (): Promise<DividerBlock> => {
        return createDividerBlock()
    },
    createComponent: () => <DividerElement/>,
})

export default DividerElement
