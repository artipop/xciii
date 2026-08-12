import {render} from '@solidjs/testing-library'

import {createCard} from '../../blocks/card'
import {IPropertyTemplate, Board} from '../../blocks/board'
import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {createCommentBlock} from '../../blocks/commentBlock'

import UpdatedTimeProperty from './property'
import UpdatedTime from './updatedTime'

describe('properties/updatedTime', () => {
    test('should match snapshot', () => {
        const card = createCard()
        card.id = 'card-id-1'
        card.modifiedBy = 'user-id-1'
        card.updateAt = Date.parse('10 Jun 2021 16:22:00')

        const comment = createCommentBlock()
        comment.modifiedBy = 'user-id-1'
        comment.parentId = 'card-id-1'
        comment.updateAt = Date.parse('15 Jun 2021 16:22:00')
        const store = mockAppStore({
            comments: {
                comments: {
                    [comment.id]: comment,
                },
                commentsByCard: {
                    [card.id]: [comment],
                },
            },
        })

        const component = () => wrapIntl(() =>
            <AppStoreProvider store={store}>
                <UpdatedTime
                    property={new UpdatedTimeProperty()}
                    card={card}
                    board={{} as Board}
                    propertyTemplate={{} as IPropertyTemplate}
                    propertyValue={''}
                    readOnly={false}
                    showEmptyPlaceholder={false}
                />
            </AppStoreProvider>,
        )

        const {container} = render(component)
        expect(container).toMatchSnapshot()
    })
})
