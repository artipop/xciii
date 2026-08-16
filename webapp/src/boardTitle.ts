// A board is told from another by its name, so two boards may not share one.
//
// It is a rule about a person's own list rather than about the data: nothing
// breaks when two boards are called «Разработка» — the app addresses everything
// by id — but the sidebar, the card's «перенести на доску» and the phone's
// board list all become a guess, and a board made from a template arrives
// carrying the template's name, so the second one collides by default.
//
// Enforced where a name is *given* (the setup wizard's first step) and where it
// is changed (the board's own title), which is every door a person types one
// through. Trimmed and case-insensitive, because two boards a person cannot
// tell apart on screen are two boards with the same name whatever the bytes
// say.
export function titleTaken(
    boards: Array<{id: string, title: string, isTemplate?: boolean}>,
    title: string,
    exceptBoardId: string,
): boolean {
    const wanted = title.trim().toLocaleLowerCase()
    if (!wanted) {
        return false
    }
    return boards.some((board) =>
        board.id !== exceptBoardId &&
        !board.isTemplate &&
        board.title.trim().toLocaleLowerCase() === wanted)
}
