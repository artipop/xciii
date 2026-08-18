import {render, waitFor} from '@solidjs/testing-library'

import {IPropertyTemplate} from '../../blocks/board'
import {TestRouter, mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {TestBlockFactory} from '../../test/testBlockFactory'

import octoClient from '../../octoClient'

import BoardTemplateSelectorPreview from './boardTemplateSelectorPreview'

const groupProperty: IPropertyTemplate = {
    id: 'group-prop-id',
    name: 'name',
    type: 'text',
    options: [
        {
            color: 'propColorOrange',
            id: 'property_value_id_1',
            value: 'Q1',
        },
        {
            color: 'propColorBlue',
            id: 'property_value_id_2',
            value: 'Q2',
        },
    ],
}

// The client is a default export, and a factory has to say so: babel's CJS
// interop used to hand the whole object back as the default, ESM does not.
vi.mock('../../octoClient', () => {
    const client = {
        getAllBlocks: vi.fn(() => Promise.resolve([
            {
                id: '1',
                teamId: 'team',
                title: 'Template',
                type: 'board',
                icon: '🚴🏻‍♂️',
                cardProperties: [groupProperty],
                dateDisplayPropertyId: 'id-5',
            },
            {
                id: '2',
                workspaceId: 'workspace',
                title: 'View',
                type: 'view',
                fields: {
                    groupById: 'group-prop-id',
                    viewType: 'board',
                    visibleOptionIds: ['group-prop-id'],
                    hiddenOptionIds: [],
                    visiblePropertyIds: ['group-prop-id'],
                    sortOptions: [],
                    kanbanCalculations: {},
                },
            },
            {
                id: '3',
                workspaceId: 'workspace',
                title: 'Card',
                type: 'card',
                fields: {
                    icon: '🚴🏻‍♂️',
                    properties: {
                        'group-prop-id': 'test',
                    },
                },
            },
        ])),
    }
    return {default: client}
})
vi.mock('../../utils')
vi.mock('../../mutator')

describe('components/boardTemplateSelector/boardTemplateSelectorPreview', () => {
    const template1Title = 'Template 1'
    const globalTemplateTitle = 'Template Global'
    const boardTitle = 'Board 1'
    let store: ReturnType<typeof mockAppStore>
    beforeAll(mockDOM)
    beforeEach(() => {
        vi.clearAllMocks()

        const board = TestBlockFactory.createBoard()
        board.id = '2'
        board.title = boardTitle
        board.teamId = 'team-id'
        board.icon = '🚴🏻‍♂️'
        board.cardProperties = [groupProperty]
        const activeView = TestBlockFactory.createBoardView(board)
        activeView.fields.defaultTemplateId = 'defaultTemplateId'

        const state = {
            searchText: {value: ''},
            users: {
                me: {
                    id: 'user-id',
                },
                myConfig: {
                    onboardingTourStarted: {value: false},
                },
            },
            cards: {
                templates: [],
                cards: {
                    card_id_1: {title: 'Create a new card'},
                },
                current: 'card_id_1',
            },
            views: {
                views: {
                    boardView: activeView,
                },
                current: 'boardView',
            },
            contents: {contents: []},
            comments: {comments: []},
            teams: {
                current: {id: 'team-id'},
            },
            boards: {
                current: board.id,
                boards: {
                    [board.id]: board,
                },
                templates: [
                    {
                        id: '1',
                        teamId: 'team-id',
                        title: template1Title,
                        icon: '🚴🏻‍♂️',
                        cardProperties: [groupProperty],
                        dateDisplayPropertyId: 'id-5',
                    },
                ],
                cards: [],
                views: [],
                myBoardMemberships: {
                    [board.id]: {userId: 'user-id', schemeAdmin: true},
                },
            },
            globalTemplates: {
                value: [{
                    id: 'global-1',
                    title: globalTemplateTitle,
                    teamId: '0',
                    icon: '🚴🏻‍♂️',
                    cardProperties: [
                        {id: 'global-id-5'},
                    ],
                    dateDisplayPropertyId: 'global-id-5',
                }],
            },
        }
        store = mockAppStore(state)
    })

    test('should match snapshot', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <BoardTemplateSelectorPreview activeTemplate={(store.state as any).boards.templates[0]}/>
                </TestRouter>
            </AppStoreProvider>
            ,
        ))
        await waitFor(() => expect(container.querySelector('.top-head')).not.toBeNull())
        expect(container).toMatchSnapshot()
    })

    // Every template carries «Входящие» as well as the view it is really
    // about, and that title sorts first — so a preview that took the first
    // view by title showed an empty inbox for every template and said nothing
    // about what the template is for.
    test('previews the view the template was made with, not the one that sorts first', async () => {
        const viewOf = (id: string, title: string, createAt: number) => ({
            id,
            workspaceId: 'workspace',
            title,
            type: 'view',
            createAt,
            fields: {
                groupById: 'group-prop-id',
                viewType: 'board',
                visibleOptionIds: ['group-prop-id'],
                hiddenOptionIds: [],
                visiblePropertyIds: ['group-prop-id'],
                sortOptions: [],
                kanbanCalculations: {},
            },
        })
        vi.mocked(octoClient.getAllBlocks).mockResolvedValueOnce([
            viewOf('v-inbox', 'Входящие', 2000),
            viewOf('v-work', 'Дела', 1000),
        ] as never)

        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <BoardTemplateSelectorPreview activeTemplate={(store.state as any).boards.templates[0]}/>
                </TestRouter>
            </AppStoreProvider>
            ,
        ))

        await waitFor(() => expect(container.querySelector('.top-head')).not.toBeNull())
        const title = container.querySelector('.ViewHeader input, .ViewHeader .viewTitle') as HTMLInputElement | null
        expect(title?.value ?? title?.textContent).toBe('Дела')
    })

    test('should be null without activeTemplate', () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <TestRouter>
                    <BoardTemplateSelectorPreview activeTemplate={null}/>
                </TestRouter>
            </AppStoreProvider>
            ,
        ))
        expect(container).toMatchSnapshot()
    })
})
