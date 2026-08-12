export type TopBoard = {
    boardID: string
    icon: string
    title: string
    activityCount: number
    activeUsers: string
    createdBy: string
}

export type TopBoardResponse = {
    has_next: boolean
    items: TopBoard[]
}
