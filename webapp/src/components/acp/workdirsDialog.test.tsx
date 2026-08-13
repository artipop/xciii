import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'
import {TestBlockFactory} from '../../test/testBlockFactory'

import WorkdirsDialog from './workdirsDialog'

vi.mock('../../mutator')

const anyWindow = window as any

describe('components/acp/workdirsDialog', () => {
    const board = TestBlockFactory.createBoard()

    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    // The two answers come first, because they decide what the list under them
    // means: the same folder is a copy per card or a branch in the folder
    // itself depending on which is chosen.
    test('asks how an agent works in a repository, and saves the answer', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([{name: 'code', path: '/tmp/code', git: true, base: 'main'}])),
            GetBoardGit: vi.fn().mockResolvedValue(JSON.stringify({mode: 'worktree'})),
            SetBoardGit: vi.fn().mockResolvedValue('{}'),
            PickDirectory: vi.fn(),
            AddAgentWorkdir: vi.fn(),
            RemoveAgentWorkdir: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() =>
            <WorkdirsDialog
                board={board}
                onClose={vi.fn()}
            />,
        ))

        await waitFor(() => expect(screen.getByText('In a repository an agent works')).toBeInTheDocument())

        // And the folders themselves are on the same screen: the choice above
        // is about them.
        expect(await screen.findByText('code')).toBeInTheDocument()

        userEvent.click(screen.getByText('in the folder itself'))
        await waitFor(() => expect(bindings.SetBoardGit).toHaveBeenCalledWith(board.id, JSON.stringify({mode: 'branch'})))
    })
})
