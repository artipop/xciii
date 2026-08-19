export type ClientConfig = {
    enablePublicSharedBoards: boolean
    featureFlags: Record<string, string>
    teammateNameDisplay: string
    maxFileSize: number

    // Whether this install has accounts on it, and therefore whether a comment
    // is addressed to anybody (docs/teamwork.md). Set by the Go side from the
    // same answer the board server was started with.
    teamMode: boolean
}
