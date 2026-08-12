// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {Show, Suspense, createSignal, lazy, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {agentBindings} from './bindings'
import {cardAgentState, refreshCardAgent} from './cardAgentState'
import {isCardTerminalAvailable} from './liveTerminals'

import './cardTerminal.scss'

// The agent, beside the card rather than inside it.
//
// There was a row in the card's body once — the agent's name, the session
// status, the branch with a deploy button, a form asking which folder and which
// agent to use, and a chevron that opened the terminal downwards. All of it is
// gone, and for one reason: a card is a person's own writing, and every one of
// those was the machine talking in the middle of it. The card was overloaded,
// and the thing a person actually wanted there — the terminal — was the part
// hardest to find.
//
// What is left is the terminal and nothing else, in a panel of its own beside
// the card. The folder and the agent are the machine's settings and are asked
// for there; the branch and the worktree are on the stamp under the card's
// title, which says the same thing in a line rather than a block.
//
// The panel starts the terminal as it opens, because opening it *is* the ask —
// there is nothing else in here to look at first.

// Lazily, like the terminal's own route: xterm is a large chunk, and a card
// whose panel is never opened should not pay for the emulator.
const InlineTerminal = lazy(() => import('./terminalPage'))

// Re-exported so the dialog beside the card asks the panel it draws, not a
// module it otherwise has no reason to know about.
export {isCardTerminalAvailable}

type Props = {
    cardId: string
    onClose: () => void
}

const CardTerminal = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()
    const state = cardAgentState(props.cardId)

    const [terminalId, setTerminalId] = createSignal('')
    const [error, setError] = createSignal('')
    const [busy, setBusy] = createSignal(true)

    // inWindow asks for a screen of its own, which is the only thing a panel
    // beside a card cannot be. Go hands back the same terminal either way.
    const start = async (inWindow: boolean) => {
        if (!bindings?.OpenCardTerminal) {
            return
        }
        setBusy(true)
        setError('')
        try {
            const handle = JSON.parse(await bindings.OpenCardTerminal(props.cardId, '', '', inWindow))

            // The desktop app has already opened the window by now; a server
            // build has no windows, so the browser opens a tab instead.
            if (inWindow && !handle.windowed && handle.url) {
                window.open(handle.url, '_blank', 'noopener')
            }
            setTerminalId(handle.id || '')
            await refreshCardAgent(props.cardId)
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }

    onMount(() => {
        start(false)
    })

    return (
        <div class='CardTerminal'>
            <div class='CardTerminal__head'>
                <span class='CardTerminal__title'>
                    {intl.formatMessage({id: 'CardTerminal.title', defaultMessage: 'Terminal'})}
                </span>
                <Show when={state().session?.status}>
                    <span class='CardTerminal__status'>{state().session?.status}</span>
                </Show>
                <div class='CardTerminal__actions'>
                    <button
                        type='button'
                        class='CardTerminal__button'
                        title={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                        aria-label={intl.formatMessage({id: 'CardTerminal.window', defaultMessage: 'Open in a separate window'})}
                        disabled={busy()}
                        onClick={() => start(true)}
                    >
                        {'⤢'}
                    </button>
                    <button
                        type='button'
                        class='CardTerminal__button'
                        title={intl.formatMessage({id: 'CardTerminal.close', defaultMessage: 'Close the panel'})}
                        aria-label={intl.formatMessage({id: 'CardTerminal.close', defaultMessage: 'Close the panel'})}
                        onClick={props.onClose}
                    >
                        {'✕'}
                    </button>
                </div>
            </div>

            <Show when={terminalId()}>
                {(id) => (
                    <div class='CardTerminal__screen'>
                        <Suspense fallback={null}>
                            <InlineTerminal terminalId={id()}/>
                        </Suspense>
                    </div>
                )}
            </Show>

            {/* Go could not work out which folder or which agent this card is
                for. There is nothing to answer that with here on purpose: both
                are the machine's settings, and a form asking for them again is
                how the card got overloaded in the first place. */}
            <Show when={error()}>
                <div class='CardTerminal__error'>
                    <div>{error()}</div>
                    <div class='CardTerminal__hint'>
                        {intl.formatMessage({id: 'CardTerminal.settings-hint', defaultMessage: 'Folders and agents are set up in this machine’s settings.'})}
                    </div>
                </div>
            </Show>
        </div>
    )
}

export default CardTerminal
