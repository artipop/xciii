import {render} from '@solidjs/testing-library'

import {wrapDNDIntl} from '../../testUtils'

import KanbanColumn from './kanbanColumn'
describe('src/components/kanban/kanbanColumn', () => {
    test('should match snapshot', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <KanbanColumn
                onDrop={vi.fn()}
            >
                {null}
            </KanbanColumn>,
        ))
        expect(container).toMatchSnapshot()
    })
})

