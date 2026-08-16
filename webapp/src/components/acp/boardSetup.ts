// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import {createResource, type Resource} from 'solid-js'

import {Board} from '../../blocks/board'

import {agentBindings} from './bindings'

// What a board needs answered before its automation can run is resolved on the
// Go side (internal/acp/setup.go) out of what the board asks for, what its
// columns imply and what this machine already has. The page reads that plan and
// renders it; it works nothing out for itself, because a second opinion here
// would be a second answer to drift from the first.

export type SetupStepKind = 'project' | 'agent' | 'deploy' | 'browser' | 'source' | 'done'
export type SetupStepStatus = 'pending' | 'done' | 'skipped'

export type SetupStep = {
    kind: SetupStepKind
    optional: boolean
    hint?: string
    status: SetupStepStatus

    // The machine can already answer this step — there is a folder, an agent.
    // Not the same as this board having answered it: the registries are the
    // machine's, and every board is asked for itself.
    ready?: boolean

    // What an answer has to satisfy — 'git' so far, asked for only by a board
    // that publishes a branch or waits for one. Go enforces it in
    // checkSetupAnswer; the page carries it to say so before it is answered.
    requires?: string[]
}

export type SetupPlan = {
    boardId: string
    steps: SetupStep[]

    // What this board calls the column a card is dragged into to be worked on.
    agentColumn?: string

    // What this board calls the column that tests. The QA step names an agent
    // for it, so the question can say which column it is about.
    testColumn?: string

    // Who already works this board's cards: the crew of its agent stages, when
    // they agree on one. The agent step opens on it, so walking the wizard
    // again shows the answer already given rather than nobody chosen.
    workAgents?: string[]

    // The board named these steps itself, rather than them being worked out
    // from the automation it carries.
    declared: boolean

    // The board brings columns or routes of its own. One that brings none is
    // not a board the wizard should open itself for.
    automated: boolean

    // The wizard has already opened itself for this board once.
    offered?: boolean
}

// The plan a board with nothing to say gets: no steps at all, so nothing is
// offered and nothing is asked. It is what a browser or plugin build sees,
// where there is no machine to set up in the first place.
export const NO_SETUP: SetupPlan = {boardId: '', steps: [], declared: false, automated: false, offered: false}

// What the trigger column is called on a board that ships none: the default the
// Go config carries (acp.DefaultConfig).
export const DEFAULT_AGENT_COLUMN = 'In Progress'

export function agentColumn(plan: SetupPlan | undefined): string {
    return plan?.agentColumn || DEFAULT_AGENT_COLUMN
}

export function isBoardSetupAvailable(): boolean {
    return Boolean(agentBindings()?.BoardSetupPlan)
}

export async function readSetupPlan(boardId: string): Promise<SetupPlan> {
    const bindings = agentBindings()
    if (!bindings?.BoardSetupPlan || !boardId) {
        return NO_SETUP
    }
    const plan = JSON.parse(await bindings.BoardSetupPlan(boardId)) as SetupPlan
    return {...plan, steps: plan.steps || []}
}

// createSetupPlan is how a component holds one: a resource keyed on the board,
// refetched when the board changes and when a step has just been answered.
export function createSetupPlan(board: () => Board | undefined): [Resource<SetupPlan>, () => void] {
    const [plan, {refetch}] = createResource(
        () => board()?.id,
        (boardId: string) => readSetupPlan(boardId),
        {initialValue: NO_SETUP},
    )
    return [plan, () => {
        refetch()
    }]
}

// Recording is for the answer no registry can be read for: a step deliberately
// passed over. Everything else is answered by the registry the step fills.
export async function recordSetupStep(boardId: string, step: SetupStepKind, status: SetupStepStatus): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.RecordBoardSetupStep || !boardId) {
        return
    }
    await bindings.RecordBoardSetupStep(boardId, step, status)
}

// checkSetupAnswer asks Go whether an answer fits the step, and throws what it
// says when it does not — the same wording the card would have got later.
export async function checkSetupAnswer(boardId: string, step: SetupStepKind, value: string): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.CheckBoardSetupAnswer || !boardId) {
        return
    }
    await bindings.CheckBoardSetupAnswer(boardId, step, value)
}

export function stepRequires(step: SetupStep | undefined, requirement: string): boolean {
    return Boolean(step?.requires?.includes(requirement))
}

export function planHasStep(plan: SetupPlan | undefined, kind: SetupStepKind): boolean {
    return Boolean(plan?.steps.some((step) => step.kind === kind))
}

// setupNeeded says this board runs something this machine cannot run yet: a
// step nobody may skip is still waiting for an answer.
export function setupNeeded(plan: SetupPlan | undefined): boolean {
    return Boolean(plan?.automated && plan.steps.some((step) => !step.optional && step.status === 'pending'))
}

// shouldOfferSetup is the rule for opening the wizard by itself, and it fires
// once per board — on the first board you open after making it. It used to fire
// on every launch until the setup was finished or refused, which meant the app
// greeted you with a modal every morning for as long as you had not got round
// to it. A thing you have already seen and closed is a reminder, not a dialog.
export function shouldOfferSetup(plan: SetupPlan | undefined): boolean {
    return setupNeeded(plan) && !plan?.offered
}

// Remembered by Go, in the store, because the page cannot: the desktop app
// serves itself on a fresh port every launch, so localStorage is keyed by an
// origin that does not survive a restart — which made "do not show this again"
// last exactly one run.
export async function markSetupOffered(boardId: string): Promise<void> {
    const bindings = agentBindings()
    if (!bindings?.MarkBoardSetupOffered || !boardId) {
        return
    }
    await bindings.MarkBoardSetupOffered(boardId)
}
