import {render, waitFor} from '@solidjs/testing-library'

import {ImageBlock} from '../../blocks/imageBlock'

import {wrapIntl} from '../../testUtils'

import octoClient from '../../octoClient'

import ImageElement from './imageElement'

vi.mock('../../octoClient')
const mockedOcto = vi.mocked(octoClient)
mockedOcto.getFileAsDataUrl.mockResolvedValue({url: 'test.jpg'})

describe('components/content/ImageElement', () => {
    const defaultBlock: ImageBlock = {
        id: 'test-id',
        boardId: '1',
        parentId: '',
        modifiedBy: 'test-user-id',
        schema: 0,
        type: 'image',
        title: 'test-title',
        fields: {
            fileId: 'test.jpg',
        },
        createdBy: 'test-user-id',
        createAt: 0,
        updateAt: 0,
        deleteAt: 0,
    }

    test('should match snapshot', async () => {
        const component = () => wrapIntl(() =>
            <ImageElement
                block={defaultBlock}
            />,
        )
        const {container} = render(component)

        // the file URL arrives async; the snapshot is of the loaded image
        await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
        expect(container).toMatchSnapshot()
    })

    test('archived file', async () => {
        mockedOcto.getFileAsDataUrl.mockResolvedValue({
            archived: true,
            name: 'Filename',
            extension: '.txt',
            size: 165002,
        })

        const component = () => wrapIntl(() =>
            <ImageElement
                block={defaultBlock}
            />,
        )
        const {container} = render(component)

        // the archived answer arrives async; the snapshot is of the notice
        await waitFor(() => expect(container.querySelector('.ArchivedFile')).not.toBeNull())
        expect(container).toMatchSnapshot()
    })
})
