// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, within, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'

import {Board, MemberRole, IPropertyTemplate} from '../../blocks/board'
import {mockAppStore, wrapDNDIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'

import {IUser} from '../../user'
import {Team} from '../../store/teams'

import BoardTemplateSelectorItem from './boardTemplateSelectorItem'

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

vi.mock('../../utils')
vi.mock('../../mutator')

describe('components/boardTemplateSelector/boardTemplateSelectorItem', () => {
    const team1: Team = {
        id: 'team-1',
        title: 'Team 1',
        signupToken: '',
        updateAt: 0,
        modifiedBy: 'user-1',
    }

    const template: Board = {
        id: '1',
        teamId: 'team-1',
        title: 'Template 1',
        createdBy: 'user-1',
        modifiedBy: 'user-1',
        createAt: 10,
        updateAt: 20,
        deleteAt: 0,
        description: 'test',
        showDescription: false,
        type: 'O',
        minimumRole: MemberRole.Editor,
        isTemplate: true,
        templateVersion: 0,
        icon: '🚴🏻‍♂️',
        cardProperties: [groupProperty],
        properties: {},
    }

    const globalTemplate: Board = {
        id: 'global-1',
        title: 'Template global',
        teamId: '0',
        createdBy: 'system',
        modifiedBy: 'system',
        createAt: 10,
        updateAt: 20,
        deleteAt: 0,
        type: 'O',
        minimumRole: MemberRole.Editor,
        icon: '🚴🏻‍♂️',
        description: 'test',
        showDescription: false,
        cardProperties: [groupProperty],
        isTemplate: true,
        templateVersion: 2,
        properties: {},
    }

    const me: IUser = {
        id: 'user-id-1',
        username: 'username_1',
        nickname: '',
        firstname: '',
        lastname: '',
        email: '',
        props: {},
        create_at: 0,
        update_at: 0,
        is_bot: false,
        is_guest: false,
        roles: 'system_user',
    }

    let store: ReturnType<typeof mockAppStore>
    beforeEach(() => {
        vi.clearAllMocks()
        const state = {
            teams: {
                current: team1,
            },
            boards: {
                current: '1',
                myBoardMemberships: {
                    1: {userId: me.id, schemeAdmin: true},
                },
                templates: {
                    [template.id]: template,
                },
            },
        }
        store = mockAppStore(state)
    })

    test('should match snapshot', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={false}
                    template={template}
                    onSelect={vi.fn()}
                    onDelete={vi.fn()}
                    onEdit={vi.fn()}
                />
            </AppStoreProvider>
            ,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot when active', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={true}
                    template={template}
                    onSelect={vi.fn()}
                    onDelete={vi.fn()}
                    onEdit={vi.fn()}
                />
            </AppStoreProvider>
            ,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should match snapshot with global template', async () => {
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={false}
                    template={globalTemplate}
                    onSelect={vi.fn()}
                    onDelete={vi.fn()}
                    onEdit={vi.fn()}
                />
            </AppStoreProvider>
            ,
        ))
        expect(container).toMatchSnapshot()
    })

    test('should trigger the onSelect (and not any other) when click the element', async () => {
        const onSelect = vi.fn()
        const onDelete = vi.fn()
        const onEdit = vi.fn()
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={false}
                    template={template}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onEdit={onEdit}
                />
            </AppStoreProvider>
            ,
        ))
        userEvent.click(container.querySelector('.BoardTemplateSelectorItem')!)
        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onSelect).toHaveBeenCalledWith(template)
        expect(onDelete).not.toHaveBeenCalled()
        expect(onEdit).not.toHaveBeenCalled()
    })

    test('should trigger the onDelete (and not any other) when click the delete icon', async () => {
        const onSelect = vi.fn()
        const onDelete = vi.fn()
        const onEdit = vi.fn()
        const {container} = render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={false}
                    template={template}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onEdit={onEdit}
                />
            </AppStoreProvider>
            ,
        ))
        userEvent.click(container.querySelector('.BoardTemplateSelectorItem .EditIcon')!)
        expect(onEdit).toHaveBeenCalledTimes(1)
        expect(onEdit).toHaveBeenCalledWith(template.id)
        expect(onSelect).not.toHaveBeenCalled()
        expect(onDelete).not.toHaveBeenCalled()
    })

    test('should trigger the onDelete (and not any other) when click the delete icon and confirm', async () => {
        const onSelect = vi.fn()
        const onDelete = vi.fn()
        const onEdit = vi.fn()

        const root = document.createElement('div')
        root.setAttribute('id', 'xciii-root-portal')
        render(() => wrapDNDIntl(() =>
            <AppStoreProvider store={store}>
                <BoardTemplateSelectorItem
                    isActive={false}
                    template={template}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onEdit={onEdit}
                />
            </AppStoreProvider>
            ,
        ), {container: document.body.appendChild(root)})
        userEvent.click(root.querySelector('.BoardTemplateSelectorItem .DeleteIcon')!)

        expect(root).toMatchSnapshot()

        const {getByText} = within(root)
        userEvent.click(getByText('Delete')!)

        await waitFor(async () => expect(onDelete).toHaveBeenCalledTimes(1))
        await waitFor(async () => expect(onDelete).toHaveBeenCalledWith(template))
        await waitFor(async () => expect(onSelect).not.toHaveBeenCalled())
        await waitFor(async () => expect(onEdit).not.toHaveBeenCalled())
    })
})
