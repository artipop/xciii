import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import Mutator from '../../mutator'
import {Team} from '../../store/teams'
import {createBoard, Board} from '../../blocks/board'
import {IUser} from '../../user'
import {TestRouter, mockAppStore, mockDOM, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import TelemetryClient from '../../telemetry/telemetryClient'

import BoardTemplateSelector from './boardTemplateSelector'

// The client is a default export, and a factory has to say so: babel's CJS
// interop used to hand the whole object back as the default, ESM does not.
vi.mock('../../octoClient', () => {
    return {
        default: {
            getAllBlocks: vi.fn(() => Promise.resolve([])),
            patchUserConfig: vi.fn(() => Promise.resolve({})),
        },
    }
})
vi.mock('../../utils')
vi.mock('../../mutator')

vi.mock('../../telemetry/telemetryClient')
const mockedTelemetry = vi.mocked(TelemetryClient)

describe('components/boardTemplateSelector/boardTemplateSelector', () => {
    const mockedMutator = vi.mocked(Mutator)
    const team1: Team = {
        id: 'team-1',
        title: 'Team 1',
        signupToken: '',
        updateAt: 0,
        modifiedBy: 'user-1',
    }
    const me: IUser = {
        id: 'user-id-1',
        username: 'username_1',
        email: '',
        nickname: '',
        firstname: '',
        lastname: '',
        props: {},
        create_at: 0,
        update_at: 0,
        is_bot: false,
        is_guest: false,
        roles: 'system_user',
    }
    const template1Title = 'Template 1'

    // The selector shows only the templates that ship their own automation,
    // and it knows them by the marker they carry (xciiiTemplate); everything
    // else is hidden. Two of the global fixtures below carry one.
    const globalTemplateTitle = 'Разработка'
    const householdTemplateTitle = 'Домашние дела'
    const boardTitle = 'Board 1'
    let store: ReturnType<typeof mockAppStore>

    // Kept where a test can build a second store out of it: one of them needs
    // the same fixtures with the marker taken away.
    let state: any
    beforeAll(mockDOM)
    beforeEach(() => {
        vi.clearAllMocks()
        state = {
            teams: {
                current: team1,
            },
            users: {
                me,
                boardUsers: {[me.id]: me},
            },
            boards: {
                boards: [
                    {
                        id: '2',
                        title: boardTitle,
                        teamId: team1.id,
                        icon: '🚴🏻‍♂️',
                        cardProperties: [
                            {id: 'id-6'},
                        ],
                        dateDisplayPropertyId: 'id-6',
                    },
                ],
                templates: [
                    {
                        id: '1',
                        teamId: team1.id,
                        title: template1Title,
                        icon: '🚴🏻‍♂️',
                        cardProperties: [
                            {id: 'id-5'},
                        ],
                        dateDisplayPropertyId: 'id-5',
                    },
                    {
                        id: '2',
                        teamId: '0',
                        title: 'Welcome to Boards!',
                        icon: '❄️',
                        cardProperties: [
                            {id: 'id-5'},
                        ],
                        dateDisplayPropertyId: 'id-5',
                        properties: {
                            trackingTemplateId: 'template_id_2',
                        },

                        // The version is what says the install put it there:
                        // the importer stamps one on every template it writes,
                        // and nothing stamps one a person made. Without it here
                        // this fixture is not the upstream default it is
                        // standing in for.
                        templateVersion: 10,
                        createdBy: 'system',
                    },
                ],
                membersInBoards: {
                    1: {userId: me.id, schemeAdmin: true},
                    2: {userId: me.id, schemeAdmin: true},
                },
                myBoardMemberships: {
                    1: {userId: me.id, schemeAdmin: true},
                    2: {userId: me.id, schemeAdmin: true},
                },
                cards: [],
                views: [],
            },

            // Deliberately not in the order the selector offers them: the
            // archive decides this order, the component decides that one.
            globalTemplates: {
                value: [{
                    id: 'global-2',
                    title: householdTemplateTitle,
                    teamId: '0',
                    icon: '🏠',
                    cardProperties: [
                        {id: 'global-id-6'},
                    ],
                    dateDisplayPropertyId: 'global-id-6',
                    isTemplate: true,
                    templateVersion: 2,
                    properties: {
                        trackingTemplateId: 'template_id_household',
                        xciiiTemplate: 'home-chores',
                    },
                    createdBy: 'system',
                }, {
                    id: 'global-1',
                    title: globalTemplateTitle,
                    teamId: '0',
                    icon: '🚴🏻‍♂️',
                    cardProperties: [
                        {id: 'global-id-5'},
                    ],
                    dateDisplayPropertyId: 'global-id-5',
                    isTemplate: true,
                    templateVersion: 2,
                    properties: {
                        trackingTemplateId: 'template_id_global',
                        xciiiTemplate: 'developer-tasks',
                    },
                    createdBy: 'system',
                }],
            },
        }
        store = mockAppStore(state)
        vi.useRealTimers()
    })
    describe('not a plugin deployment', () => {
        test('should match snapshot', () => {
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            expect(container).toMatchSnapshot()
        })
    })
    describe('a plugin deployment', () => {
        test('should match snapshot', () => {
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            expect(container).toMatchSnapshot()
        })
        test('should match snapshot without close', () => {
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            expect(container).toMatchSnapshot()
        })
        test('should match snapshot with custom title and description', () => {
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector
                        title='test-title'
                        description='test-description'
                    />
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            expect(container).toMatchSnapshot()
        })
        test('return BoardTemplateSelector and click close call the onClose callback', () => {
            const onClose = vi.fn()
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={onClose}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            const divCloseButton = container.querySelector('div.toolbar .CloseIcon')
            expect(divCloseButton).not.toBeNull()
            userEvent.click(divCloseButton!)
            expect(onClose).toHaveBeenCalledTimes(1)
        })
        test('return BoardTemplateSelector and click new template', () => {
            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            const divNewTemplate = screen.getByText('Create new template').parentElement
            expect(divNewTemplate).not.toBeNull()
            userEvent.click(divNewTemplate!)
            expect(mockedMutator.addEmptyBoardTemplate).toHaveBeenCalledTimes(1)
        })
        test('return BoardTemplateSelector and click empty board', async () => {
            const newBoard = createBoard({id: 'new-board'} as Board)
            mockedMutator.addEmptyBoard.mockResolvedValue({boards: [newBoard], blocks: []})

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})

            const divEmptyboard = screen.getByText('Create empty board').parentElement
            expect(divEmptyboard).not.toBeNull()
            userEvent.click(divEmptyboard!)
            expect(mockedMutator.addEmptyBoard).toHaveBeenCalledTimes(1)
            await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledWith(newBoard, newBoard, 'linked channel'))
        })
        test('offers ours and the user’s own, and hides the upstream ones', () => {
            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})

            // the everyday-life boards stand beside the developer one
            expect(screen.getByText(globalTemplateTitle)).not.toBeNull()
            expect(screen.getByText(householdTemplateTitle)).not.toBeNull()

            // and so does a template of the user's own, whatever it carries:
            // hiding it is how "Create new template" used to lead nowhere
            expect(screen.getByText(template1Title)).not.toBeNull()

            // what stays hidden is the install's own upstream ones
            expect(screen.queryByText('Welcome to Boards!')).toBeNull()
        })

        // In this app the board's team *is* the global team, so the fetch that
        // fills globalTemplates never runs and every template — the install's
        // own and the user's alike — arrives with the board list instead.
        // Reading only globalTemplates is how the picker came to offer nothing
        // at all, on the one deployment the product actually ships as.
        test('offers them when they arrive with the board list and no global fetch runs', () => {
            const oneTeam = mockAppStore({
                ...state,
                boards: {
                    ...state.boards,
                    templates: [...state.boards.templates, ...state.globalTemplates.value],
                },
                globalTemplates: {value: []},
            })

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={oneTeam}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})

            expect(screen.getByText(globalTemplateTitle)).not.toBeNull()
            expect(screen.getByText(householdTemplateTitle)).not.toBeNull()
            expect(screen.getByText(template1Title)).not.toBeNull()
            expect(screen.queryByText('Welcome to Boards!')).toBeNull()
        })

        // What makes a template ours is the marker it ships, not its title.
        // Keyed on the title, this filter would offer a stranger that happens
        // to be called the same — and would offer nothing at all the day
        // somebody rewords one of ours.
        test('goes by the marker a template carries, not by its name', () => {
            const impostor = {
                ...state.globalTemplates.value[1],
                id: 'global-3',
                properties: {trackingTemplateId: 'template_id_impostor'},
            }
            const storeWithImpostor = mockAppStore({
                ...state,
                globalTemplates: {value: [impostor]},
            })

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={storeWithImpostor}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})

            expect(screen.queryByText(globalTemplateTitle)).toBeNull()
        })
        test('opens on the developer template however the archive ordered them', () => {
            const {container} = render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})

            const offered = [...container.querySelectorAll('.BoardTemplateSelectorItem')]
            expect(offered.map((item) => item.textContent)).toEqual([
                expect.stringContaining(globalTemplateTitle),
                expect.stringContaining(householdTemplateTitle),

                // the user's own come after the ones the install ships
                expect.stringContaining(template1Title),
            ])
            expect(offered[0]!.className).toContain('active')
        })
        test('return BoardTemplateSelector and click to add board from template', async () => {
            const newBoard = createBoard({id: 'new-board'} as Board)
            mockedMutator.addBoardFromTemplate.mockResolvedValue({boards: [newBoard], blocks: []})

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            const divBoardToSelect = screen.getByText(globalTemplateTitle).parentElement
            expect(divBoardToSelect).not.toBeNull()

            userEvent.click(divBoardToSelect!)

            const useTemplateButton = screen.getByText('Use this template').parentElement
            expect(useTemplateButton).not.toBeNull()
            userEvent.click(useTemplateButton!)

            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledTimes(1))
            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledWith(team1.id, expect.anything(), expect.anything(), expect.anything(), 'global-1', team1.id))
            await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledWith(newBoard, newBoard, 'linked channel'))
        })

        test('return BoardTemplateSelector and click to add board from template with channelId', async () => {
            const newBoard = createBoard({id: 'new-board'} as Board)
            mockedMutator.addBoardFromTemplate.mockResolvedValue({boards: [newBoard], blocks: []})

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector
                        onClose={vi.fn()}
                        channelId='test-channel'
                    />
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            const divBoardToSelect = screen.getByText(globalTemplateTitle).parentElement
            expect(divBoardToSelect).not.toBeNull()

            userEvent.click(divBoardToSelect!)

            const useTemplateButton = screen.getByText('Use this template').parentElement
            expect(useTemplateButton).not.toBeNull()
            userEvent.click(useTemplateButton!)

            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledTimes(1))
            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledWith(team1.id, expect.anything(), expect.anything(), expect.anything(), 'global-1', team1.id))
            await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledWith({...newBoard, channelId: 'test-channel'}, newBoard, 'linked channel'))
        })

        test('return BoardTemplateSelector and click to add board from global template', async () => {
            const newBoard = createBoard({id: 'new-board'} as Board)
            mockedMutator.addBoardFromTemplate.mockResolvedValue({boards: [newBoard], blocks: []})

            render(() => wrapDNDIntl(() =>
                <AppStoreProvider store={store}>
                    <BoardTemplateSelector onClose={vi.fn()}/>
                </AppStoreProvider>
                ,
            ), {wrapper: TestRouter})
            const divBoardToSelect = screen.getByText(globalTemplateTitle).parentElement
            expect(divBoardToSelect).not.toBeNull()

            userEvent.click(divBoardToSelect!)

            const useTemplateButton = screen.getByText('Use this template').parentElement
            expect(useTemplateButton).not.toBeNull()
            userEvent.click(useTemplateButton!)
            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledTimes(1))
            await waitFor(() => expect(mockedMutator.addBoardFromTemplate).toHaveBeenCalledWith(team1.id, expect.anything(), expect.anything(), expect.anything(), 'global-1', team1.id))
            await waitFor(() => expect(mockedTelemetry.trackEvent).toHaveBeenCalledWith('boards', 'createBoardViaTemplate', {boardTemplateId: 'template_id_global'}))
            await waitFor(() => expect(mockedMutator.updateBoard).toHaveBeenCalledWith(newBoard, newBoard, 'linked channel'))
        })
    })
})
