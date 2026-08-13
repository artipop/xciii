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

    // The choice is on the repository's own row: it is a fact about that
    // repository, so it holds on every board the folder is offered on.
    test('asks how a repository is worked in, on its own row', async () => {
        const bindings = {
            ListAgentWorkdirs: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'code', path: '/tmp/code', git: true, base: 'main', mode: 'worktree'},
            ])),
            SetAgentWorkdirMode: vi.fn().mockResolvedValue('{}'),
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

        expect(await screen.findByText('code')).toBeInTheDocument()

        userEvent.click(screen.getByRole('button', {name: 'in the folder itself'}))
        await waitFor(() => expect(bindings.SetAgentWorkdirMode).toHaveBeenCalledWith('code', board.id, 'branch'))
    })
})
