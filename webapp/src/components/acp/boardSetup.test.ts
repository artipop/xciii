// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {
    NO_SETUP,
    SetupPlan,
    SetupStep,
    agentColumn,
    checkSetupAnswer,
    isBoardSetupAvailable,
    offeredFor,
    planHasStep,
    readSetupPlan,
    recordSetupStep,
    rememberOffered,
    setupNeeded,
    shouldOfferSetup,
    stepRequires,
} from './boardSetup'

const anyWindow = window as any

function plan(steps: Array<Partial<SetupStep>>, extra: Partial<SetupPlan> = {}): SetupPlan {
    return {
        boardId: 'board-1',
        declared: true,
        automated: true,
        steps: steps.map((step) => ({kind: 'project', optional: false, status: 'pending', ...step} as SetupStep)),
        ...extra,
    }
}

describe('components/acp/boardSetup', () => {
    afterEach(() => {
        delete anyWindow.go
        localStorage.clear()
        vi.clearAllMocks()
    })

    test('outside the desktop app there is no machine to set up', async () => {
        expect(isBoardSetupAvailable()).toBe(false)
        expect(await readSetupPlan('board-1')).toEqual(NO_SETUP)

        // And recording an answer is a no-op rather than a crash.
        await recordSetupStep('board-1', 'deploy', 'skipped')
    })

    test('the plan comes from Go, and a board with no id is not asked for one', async () => {
        const BoardSetupPlan = vi.fn().mockResolvedValue(JSON.stringify(plan([{kind: 'project'}])))
        anyWindow.go = {main: {App: {BoardSetupPlan}}}

        expect((await readSetupPlan('board-1')).steps).toHaveLength(1)
        expect(BoardSetupPlan).toHaveBeenCalledWith('board-1')

        expect(await readSetupPlan('')).toEqual(NO_SETUP)
        expect(BoardSetupPlan).toHaveBeenCalledTimes(1)
    })

    // What the board is still missing, and therefore what the header reminder
    // reads: a question nobody may skip that nobody has answered.
    test('setup is needed while a step nobody may skip is unanswered', () => {
        expect(setupNeeded(plan([{kind: 'project', status: 'pending'}]))).toBe(true)
        expect(setupNeeded(plan([{kind: 'project', status: 'done'}]))).toBe(false)

        // A skippable question left unanswered is not the board being unset up.
        expect(setupNeeded(plan([{kind: 'deploy', optional: true, status: 'pending'}]))).toBe(false)

        // Neither is a board that runs nothing of its own.
        expect(setupNeeded(plan([{kind: 'project'}], {automated: false}))).toBe(false)
        expect(setupNeeded(undefined)).toBe(false)
    })

    test('the wizard offers itself once per board', () => {
        const pending = plan([{kind: 'project', status: 'pending'}])
        expect(shouldOfferSetup(pending, 'board-1')).toBe(true)

        rememberOffered('board-1')
        expect(offeredFor('board-1')).toBe(true)
        expect(shouldOfferSetup(pending, 'board-1')).toBe(false)

        // Another board gets its own turn.
        expect(shouldOfferSetup(pending, 'board-2')).toBe(true)

        // And the need outlives the offer — that is what the reminder reads.
        expect(setupNeeded(pending)).toBe(true)
    })

    test('a step the board never asks for is not a setting worth offering', () => {
        const chores = plan([{kind: 'project'}, {kind: 'agent'}, {kind: 'done'}])
        expect(planHasStep(chores, 'project')).toBe(true)
        expect(planHasStep(chores, 'deploy')).toBe(false)
        expect(planHasStep(undefined, 'deploy')).toBe(false)
    })

    // Git is a requirement of the board's automation, not of the app: the page
    // only carries what Go said and asks it to check the answer.
    test('a step may require something of its answer', async () => {
        const needsGit = plan([{kind: 'project', requires: ['git']}])
        expect(stepRequires(needsGit.steps[0], 'git')).toBe(true)
        expect(stepRequires(plan([{kind: 'project'}]).steps[0], 'git')).toBe(false)
        expect(stepRequires(undefined, 'git')).toBe(false)

        const CheckBoardSetupAnswer = vi.fn().mockRejectedValue('в каталоге /tmp/notes нет git-репозитория')
        anyWindow.go = {main: {App: {CheckBoardSetupAnswer}}}
        await expect(checkSetupAnswer('board-1', 'project', '/tmp/notes')).rejects.toBeTruthy()
        expect(CheckBoardSetupAnswer).toHaveBeenCalledWith('board-1', 'project', '/tmp/notes')
    })

    test('the agent column is the board’s own, or the name the config ships', () => {
        expect(agentColumn(plan([], {agentColumn: 'Агент готовит'}))).toBe('Агент готовит')
        expect(agentColumn(plan([]))).toBe('In Progress')
        expect(agentColumn(undefined)).toBe('In Progress')
    })
})
