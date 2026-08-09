// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

type TelemetryProps = {
    trackingLocation: string
}
export interface IAppWindow extends Window {
    baseURL?: string
    frontendBaseURL?: string

    // Absolute base URL the WebSocket client should connect to, overriding the
    // page origin. Set by native desktop wrappers (e.g. the Wails macOS app)
    // whose webview origin differs from the server, so the socket reaches the
    // real server directly. Unused in browser/plugin deployments.
    webSocketBaseURL?: string
    getCurrentTeamId?: () => string
    msCrypto: Crypto
    openInNewBrowser?: ((href: string) => void) | null

    // Bindings injected by the Wails desktop wrapper (window.go.main.App.*).
    // Absent in browser/plugin deployments; feature-detect before use.
    go?: {
        main?: {
            App?: {
                ListAgentProjects(boardId: string): Promise<string>
                PickDirectory(title: string): Promise<string>
                AddAgentProject(name: string, path: string, boardId: string, global: boolean): Promise<string>

                // Registry entries no board has claimed — what an install from
                // before board-owned projects is left with — and the call that
                // gives one to a board.
                ListUnattachedProjects?(): Promise<string>
                AttachAgentProject?(name: string, boardId: string): Promise<string>
                RemoveAgentProject(name: string): Promise<void>
                ListAgents(): Promise<string>
                AddAgent(entryJSON: string): Promise<string>
                UpdateAgent(entryJSON: string): Promise<string>
                RemoveAgent(name: string): Promise<void>
                ListProxies(): Promise<string>
                AddProxy(entryJSON: string): Promise<string>
                UpdateProxy(entryJSON: string): Promise<string>
                RemoveProxy(name: string): Promise<void>
                SyncAgentUsers?(boardId: string): Promise<string>
                ListAgentAdapters?(): Promise<string>
                InstallAgentAdapter?(kind: string): Promise<string>
                AgentOptions?(entryJSON: string, refresh: boolean): Promise<string>
                ListDeployTargets(): Promise<string>
                AddDeployTarget(entryJSON: string): Promise<string>
                UpdateDeployTarget(entryJSON: string): Promise<string>
                RemoveDeployTarget(name: string): Promise<void>
                ListFlows(boardId: string): Promise<string>
                ListFlowTriggers(): Promise<string>
                ListFlowTemplates(): Promise<string>
                ListBoardColumns(boardId: string): Promise<string>
                SaveBoardColumn(specJSON: string): Promise<string>
                RemoveBoardColumn(boardId: string, optionId: string, column: string): Promise<void>
                GetWorktreeMode(): Promise<string>
                GetCardFlow(cardId: string): Promise<string>
                GetBoardFlowOverview(boardId: string): Promise<string>
                SeedBoardAutomation(boardId: string): Promise<void>
                BoardSetupPlan(boardId: string): Promise<string>
                RecordBoardSetupStep(boardId: string, step: string, status: string): Promise<void>
                CheckBoardSetupAnswer(boardId: string, step: string, value: string): Promise<void>
                MarkBoardSetupOffered(boardId: string): Promise<void>
                ListSetupSteps(): Promise<string>
                AddFlow(entryJSON: string): Promise<string>
                UpdateFlow(entryJSON: string): Promise<string>
                RemoveFlow(name: string): Promise<void>
                GetAgentSystemPrompt(): Promise<string>
                SetAgentSystemPrompt(text: string): Promise<void>
                StartCardDeploy(cardId: string, branch: string): Promise<string>

                // Terminal windows: the agent's own CLI on a card, opened in a
                // window of the desktop app (absent in browser builds).
                OpenCardTerminal?(cardId: string, projectName: string, agentName: string): Promise<string>
                OpenPlanningTerminal?(projectName: string, agentName: string): Promise<string>
                GetTerminalInfo?(terminalId: string): Promise<string>
                GetCardAgent?(cardId: string): Promise<string>
                CancelSession(cardId: string): Promise<boolean>
                ListTerminals?(): Promise<string>

                // The answer an agent is waiting on: an option it offered, or
                // words typed instead. Both empty is a refusal.
                AnswerQuestion?(questionId: string, optionId: string, text: string): Promise<void>

                // What is waiting for a person right now: the agents that have
                // asked something and gone quiet (acp:attention keeps it current).
                ListAttention?(): Promise<string>
                ShowTerminal?(terminalId: string): Promise<string>
                CloseTerminal?(terminalId: string): Promise<void>

                // Whether the board is published on the user's own tailnet, and
                // the address a phone opens. The second takes effect at once —
                // the node is brought up or closed by the call itself.
                GetTailnetAccess?(): Promise<string>
                SetTailnetAccess?(entryJson: string): Promise<string>

                // What turns into cards on a board on its own. AddSource and
                // ResetSourceToken are the only calls that ever return the
                // ingest token: only its hash is kept, so it is shown once.
                ListSources?(boardId: string): Promise<string>
                AddSource?(entryJson: string): Promise<string>
                UpdateSource?(entryJson: string): Promise<string>
                ResetSourceToken?(name: string): Promise<string>
                RemoveSource?(name: string): Promise<void>
                SourceEvents?(name: string, limit: number): Promise<string>

                // The board as the page at /m reads it. That page is served
                // the bindings and the event socket and no board API of its
                // own, which is what lets it work through the tailnet door
                // exactly as it does in the window.
                ListBoards?(): Promise<string>
                ListBoardCards?(boardId: string): Promise<string>
                ListInbox?(): Promise<string>
                MoveCardToBoard?(cardId: string, boardId: string, column: string): Promise<void>
            }
        }
    }

    // Wails event bus, injected alongside the bindings. Present only in the
    // desktop app; feature-detect before use.
    runtime?: {
        EventsOn(event: string, callback: (...data: any[]) => void): () => void
    }
    webkit?: {messageHandlers: {nativeApp?: {postMessage: <T>(message: T) => void}}}
    openPricingModal?: () => (telemetry: TelemetryProps) => void
}

// SuiteWindow documents all custom properties
// which may be defined on global
// window object when operating in
// the Mattermost suite environment
export type SuiteWindow = Window & {
    getCurrentTeamId?: () => string
    baseURL?: string
    frontendBaseURL?: string
    WebappUtils?: any
}
