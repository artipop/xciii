import {render} from '@solidjs/testing-library'

import {FileInfo} from '../../../blocks/block'

import ArchivedFile from './archivedFile'

describe('components/content/archivedFile', () => {
    it('should match snapshot', () => {
        const fileInfo: FileInfo = {
            archived: true,
            extension: '.txt',
            name: 'stuff to put in jell-o',
            size: 2056,
        }

        const {container} = render(() => <ArchivedFile fileInfo={fileInfo}/>)
        expect(container).toMatchSnapshot()
    })
})
