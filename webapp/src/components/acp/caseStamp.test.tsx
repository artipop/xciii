import {render, screen, waitFor} from '@solidjs/testing-library'
import '@testing-library/jest-dom'

import CaseStamp from './caseStamp'

const anyWindow = window as any

function cardBindings(state: any) {
    return {GetCardAgent: vi.fn().mockResolvedValue(JSON.stringify(state))}
}

describe('components/acp/caseStamp', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete anyWindow.go
    })

    // A card nobody has run an agent on is not a case yet, and a line of empty
    // labels under its title would be noise on every card on the board.
    it('says nothing about a card no agent has touched', async () => {
        anyWindow.go = {main: {App: cardBindings({})}}

        const {container} = render(() => <CaseStamp cardId='card-1'/>)

        await waitFor(() => expect(container.querySelector('.CaseStamp')).toBeNull())
    })

    // Where the work lives is the thing a person opening a card wants first,
    // and it used to be reachable only by scrolling to the agent's own row.
    it('stamps the branch, the worktree and the session on a card that has been worked', async () => {
        anyWindow.go = {
            main: {
                App: cardBindings({
                    session: {
                        status: 'finished',
                        branch: 'xciii/card-1',
                        worktree: '/Users/someone/work/xciii-card-1',
                    },
                }),
            },
        }

        render(() => <CaseStamp cardId='card-2'/>)

        expect(await screen.findByText('xciii/card-1')).toBeInTheDocument()
        expect(await screen.findByText('finished')).toBeInTheDocument()

        // The worktree is an absolute path; the stamp shows what identifies it
        // and keeps the rest in the tooltip.
        expect(await screen.findByText('xciii-card-1')).toBeInTheDocument()
        expect(screen.getByTitle('/Users/someone/work/xciii-card-1')).toBeInTheDocument()
    })

    // A resumable terminal is a case still open, and it names its branch even
    // though no session is running right now.
    it('falls back to what a resumable terminal knows', async () => {
        anyWindow.go = {
            main: {
                App: cardBindings({
                    resume: {available: true, branch: 'xciii/card-9', cwd: '/tmp/wt/card-9'},
                }),
            },
        }

        render(() => <CaseStamp cardId='card-3'/>)

        expect(await screen.findByText('xciii/card-9')).toBeInTheDocument()
        expect(await screen.findByText('card-9')).toBeInTheDocument()
    })
})
