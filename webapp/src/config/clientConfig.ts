export type ClientConfig = {
    enablePublicSharedBoards: boolean
    featureFlags: Record<string, string>
    teammateNameDisplay: string
    maxFileSize: number
}
