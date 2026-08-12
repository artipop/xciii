// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {For, Show, Suspense, createSignal, lazy, onMount} from 'solid-js'

import {useIntl} from '../../intl'

import {agentBindings} from './bindings'
import {cardAgentState, refreshCardAgent, type CardConversation} from './cardAgentState'
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
// the card. The branch and the worktree are on the stamp under the card's
// title, which says the same thing in a line rather than a block.
//
// **A conversation per stage.** A card travels its route, and different agents
// may work its different stages, so the terminal here is the conversation of
// the stage the card stands on — opening the panel opens that one, and the row
// of chips under the head lists the others. A passed stage's conversation is
// closed: it comes back when the card does, because the stage is then current
// again. Only Go knows that rule; there is deliberately no way to ask it for
// another stage's terminal.
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

    const conversations = () => state().conversations || []
    const currentStage = () => conversations().find((c) => c.current)?.column || ''

    // The chips exist once the card has stages to tell apart: one node-less
    // conversation is the whole story and needs no row about itself.
    const showsStages = () => conversations().some((c) => c.nodeId)

    const stageLabel = (c: CardConversation) =>
        c.column || intl.formatMessage({id: 'CardTerminal.no-stage', defaultMessage: 'before the route'})
    const stageTitle = (c: CardConversation) => {
        if (c.current) {
            return intl.formatMessage({id: 'CardTerminal.stage-current', defaultMessage: 'The stage the card is on — this conversation is open here'})
        }
        if (c.running) {
            return intl.formatMessage({id: 'CardTerminal.stage-running', defaultMessage: 'Still running — reachable until its CLI exits'})
        }
        return intl.formatMessage({id: 'CardTerminal.stage-passed', defaultMessage: 'A passed stage — its conversation returns if the card does'})
    }

    return (
        <div class='CardTerminal'>
            <div class='CardTerminal__head'>
                <span class='CardTerminal__title'>
                    {intl.formatMessage({id: 'CardTerminal.title', defaultMessage: 'Terminal'})}
                    <Show when={currentStage()}>
                        <span class='CardTerminal__stage'>{` · ${currentStage()}`}</span>
                    </Show>
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

            {/* The card's conversations, one per stage. Chips, not buttons:
                only the current stage's conversation can be opened, and it is
                the one already open — the rest are the card's history saying
                where it has been worked. */}
            <Show when={showsStages()}>
                <div class='CardTerminal__stages'>
                    <For each={conversations()}>
                        {(c) => (
                            <span
                                class='CardTerminal__stageChip'
                                classList={{
                                    'CardTerminal__stageChip--current': Boolean(c.current),
                                    'CardTerminal__stageChip--running': Boolean(c.running) && !c.current,
                                }}
                                title={stageTitle(c)}
                            >
                                {stageLabel(c)}
                                <Show when={c.agent}>
                                    <span class='CardTerminal__stageAgent'>{` — ${c.agent}`}</span>
                                </Show>
                            </span>
                        )}
                    </For>
                </div>
            </Show>

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
