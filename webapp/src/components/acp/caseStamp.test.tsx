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

    // Where the work lives is the thing a person opening a card wants first —
    // and it is one place, not two. A copy is the branch checked out
    // elsewhere, and stamping «branch» and «worktree» side by side read as the
    // app having created two things: the complaint this screen started from.
    it('stamps one line for where the work lives, plus the session', async () => {
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

        // The copy's path rides in the branch line's tooltip; it is not a
        // second line, because it is not a second thing.
        expect(screen.getByTitle('/Users/someone/work/xciii-card-1')).toBeInTheDocument()
        expect(screen.queryByText('xciii-card-1')).toBeNull()
        expect(screen.queryByText('worktree')).toBeNull()
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
        expect(screen.queryByText('card-9')).toBeNull()
    })

    // A folder with no branch — an ordinary folder, or the board's drafts —
    // is the one case the directory itself is the fact worth stamping.
    it('stamps the folder when there is no branch', async () => {
        anyWindow.go = {
            main: {
                App: cardBindings({
                    resume: {available: true, cwd: '/Users/someone/notes'},
                }),
            },
        }

        render(() => <CaseStamp cardId='card-4'/>)

        expect(await screen.findByText('notes')).toBeInTheDocument()
    })
})
