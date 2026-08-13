import {BoardView} from '../../blocks/boardView'

// Which of a board's views is «Входящие».
//
// By title, and by title on purpose: it is the same key the Go side uses to
// decide whether the view is already there (boardadapter.InboxViewTitle), and a
// second, cleverer answer here would drift from it — a marker field neither the
// board server nor an exported archive knows about. Renaming the view detaches
// both halves at once, which is the bargain that was already struck; what must
// not happen is the page and the writer disagreeing about which view this is.

export const InboxViewTitle = 'Входящие'

// What the inbox's own-tasks column is called — the name the Go side gives the
// board column a card made with «Создать» lands in (boardadapter
// .MineColumnTitle). The inbox view is grouped by author, so the person's own
// cards form a column headed by their username; that column *is* their
// unprocessed tasks, and it is headed by this name rather than by «Вы».
// A given name, not a translation: the column on the board says «Мои задачи»
// whatever the UI language, so its face on the inbox does too.
export const MineColumnTitle = 'Мои задачи'

export function isInboxView(view?: BoardView): boolean {
    return (view?.title ?? '').trim().toLowerCase() === InboxViewTitle.toLowerCase()
}
