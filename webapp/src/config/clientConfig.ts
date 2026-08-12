export type ClientConfig = {
    telemetry: boolean
    telemetryid: string
    enablePublicSharedBoards: boolean
    featureFlags: Record<string, string>
    teammateNameDisplay: string
    maxFileSize: number
}
