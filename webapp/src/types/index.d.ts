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
                ListAgentWorkdirs(boardId: string): Promise<string>
                PickDirectory(title: string): Promise<string>
                AddAgentWorkdir(name: string, path: string, boardId: string, kind: string, global: boolean): Promise<string>

                // What work in a folder branches from, and what «влито в
                // основную» waits for. Empty falls back to what git says.
                SetAgentWorkdirBase?(name: string, branch: string): Promise<string>

                // How a repository is worked in on this board: "worktree" — a
                // copy of its own per card — or "branch" — a branch in the
                // folder itself. Per (board, folder).
                SetAgentWorkdirMode?(name: string, boardId: string, mode: string): Promise<string>

                // The entry a path is already registered as, whichever board
                // owns it, and the call that makes one every board's. Between
                // them, "this folder is already added" is a choice offered
                // rather than a refusal.
                FindAgentWorkdir?(path: string): Promise<string>
                ShareAgentWorkdir?(name: string): Promise<string>

                // Registry entries no board has claimed — what an install from
                // before board-owned workdirs is left with — and the call that
                // gives one to a board.
                ListUnattachedWorkdirs?(): Promise<string>
                AttachAgentWorkdir?(name: string, boardId: string): Promise<string>
                RemoveAgentWorkdir(name: string): Promise<void>
                ListAgents(): Promise<string>

                // The registry as the board knows it: [{name, username}]. The
                // username is what recognises an agent among the board's
                // people, and the fold that makes it belongs to the Go side.
                ListAgentAccounts?(): Promise<string>
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

                GetCardFlow(cardId: string): Promise<string>
                GetBoardFlowOverview(boardId: string): Promise<string>
                SeedBoardAutomation(boardId: string): Promise<void>
                BoardSetupPlan(boardId: string): Promise<string>
                RecordBoardSetupStep(boardId: string, step: string, status: string): Promise<void>
                CheckBoardSetupAnswer(boardId: string, step: string, value: string): Promise<void>

                // The QA step's answer: the agent that tests this board gets
                // the browser server, and the board's test column gets that
                // agent as its crew.
                SetBoardTestAgent?(boardId: string, agentName: string, serversJson: string): Promise<void>

                // The agent step's answer on a machine with more than one
                // agent: the chosen one becomes the crew of the board's agent
                // columns, which is where "who works this board" is kept.
                SetBoardWorkAgent?(boardId: string, namesJson: string): Promise<void>

                // Which agents this board names in its automation, and which
                // agents exist at all — as board usernames, so the card's
                // assignee list can drop an agent this board has nothing to do
                // with and leave everybody else alone.
                BoardAgentUsers?(boardId: string): Promise<string>
                MarkBoardSetupOffered(boardId: string): Promise<void>
                ListSetupSteps(): Promise<string>
                AddFlow(entryJSON: string): Promise<string>
                UpdateFlow(entryJSON: string): Promise<string>
                RemoveFlow(boardId: string, name: string): Promise<void>
                ExportBoardAutomation?(boardId: string): Promise<string>

                GetBoardPrompt?(boardId: string): Promise<string>
                SetBoardPrompt?(boardId: string, text: string): Promise<void>
                GetPlanningPrompt?(): Promise<string>
                SetPlanningPrompt?(text: string): Promise<void>

                // The agent invents each card's branch name in a short
                // headless run; off means the title is transliterated instead.
                GetAgentNamedBranches?(): Promise<boolean>
                SetAgentNamedBranches?(on: boolean): Promise<void>
                StartCardDeploy(cardId: string, branch: string): Promise<string>

                // Terminals: the agent's own CLI on a card. `window` asks for a
                // window of the desktop app; without it the card draws the
                // terminal inside itself, which is what its chevron opens.
                OpenCardTerminal?(cardId: string, workdirName: string, agentName: string, window: boolean): Promise<string>
                OpenCardTalk?(cardId: string, workdirName: string, agentName: string, window: boolean): Promise<string>
                OpenPlanningTerminal?(workdirName: string, agentName: string, boardId: string): Promise<string>
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

                // "I have seen this one." The wait stands — the card keeps its
                // amber button — and only the notification stops, until the
                // agent does something and goes quiet again.
                AckAttention?(key: string): Promise<void>
                ShowTerminal?(terminalId: string): Promise<string>
                CloseTerminal?(terminalId: string): Promise<void>

                // What a conversation is called. It starts as the card's title,
                // which says which card and nothing about what is going on in
                // it; the recap beside it in the list is the agent's own, written
                // through the board tools.
                RenameTerminal?(terminalId: string, title: string): Promise<void>

                // The same field, filled in by the agent instead: the request is
                // typed into the conversation and answered through the board
                // tools, because a pty carries no name for what is happening in
                // it.
                AskTerminalName?(terminalId: string): Promise<void>

                // Throwing one of a card's conversations away: the CLI ends and
                // the record goes with it, so the next one starts fresh.
                DeleteCardConversation?(cardId: string, nodeId: string): Promise<void>

                // Whether the board is published on the user's own tailnet, and
                // the address a phone opens. The second takes effect at once —
                // the node is brought up or closed by the call itself.
                GetTailnetAccess?(): Promise<string>
                SetTailnetAccess?(entryJson: string): Promise<string>

                // Replacing this app with a newer one. Everything except the
                // state read is fire-and-forget: what came of it arrives as the
                // acp:update event, so a check somebody else started looks the
                // same as one this panel asked for.
                GetUpdateState?(): Promise<string>
                SetUpdateSettings?(entryJson: string): Promise<string>
                CheckForUpdate?(): Promise<void>
                InstallUpdate?(): Promise<void>
                SkipUpdateVersion?(): Promise<void>
                RestartToUpdate?(): Promise<void>

                // What turns into cards on a board on its own. AddSource and
                // ResetSourceToken are the only calls that ever return the
                // ingest token: only its hash is kept, so it is shown once.
                ListSources?(boardId: string): Promise<string>
                AddSource?(entryJson: string): Promise<string>
                UpdateSource?(entryJson: string): Promise<string>
                ResetSourceToken?(name: string): Promise<string>
                RemoveSource?(name: string): Promise<void>
                SourceEvents?(name: string, limit: number): Promise<string>

                // What a source can be made *of*: the manifests this machine
                // knows. With MCP a manifest is the whole adapter, so a new
                // service is a JSON file in <dataDir>/sources/manifests.
                ListSourcePlugins?(): Promise<string>

                // The token a source has to *present* — the other direction
                // from ResetSourceToken, which authorizes what is sent to it.
                SetSourceCredential?(name: string, token: string): Promise<void>
                SourceStatuses?(): Promise<string>

                // The board as the page at /m reads it. That page is served
                // the bindings and the event socket and no board API of its
                // own, which is what lets it work through the tailnet door
                // exactly as it does in the window.
                ListBoards?(): Promise<string>
                ListBoardCards?(boardId: string): Promise<string>
                ListInbox?(): Promise<string>
                MoveCardToBoard?(cardId: string, boardId: string, column: string): Promise<void>

                // The system's «Поделиться»: a link arrives from another app,
                // the /share dialog asks which board, and this files it.
                ShareItem?(boardId: string, title: string, url: string, note: string): Promise<string>
                CloseShareWindow?(): Promise<void>
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
