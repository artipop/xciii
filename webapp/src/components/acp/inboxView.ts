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

export function isInboxView(view?: BoardView): boolean {
    return (view?.title ?? '').trim().toLowerCase() === InboxViewTitle.toLowerCase()
}
