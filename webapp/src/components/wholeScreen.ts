import {createSignal, onCleanup} from 'solid-js'

// Something has taken the whole window, and the sidebar stands down while it
// has it.
//
// One screen asks for this — the route editor, which is a canvas the width of
// the board and a panel beside it. The sidebar is not behind that dialog the
// way it looks: `.mainFrame` carries a z-index and is therefore a stacking
// context, so a dialog inside it competes at the frame's own level, and the
// collapsed sidebar's ☰ — which has to float over the board — was drawn on top
// of the editor's title.
//
// A counter rather than a flag, so two overlays can hold it at once and the
// second one closing does not put the sidebar back under the first.
const [taken, setTaken] = createSignal(0)

// screenTaken is what the sidebar reads. An accessor, so it is tracked.
export const screenTaken = (): boolean => taken() > 0

// useWholeScreen is called by the component that takes the window. It releases
// on cleanup, so a dialog that is closed — or a page that navigates away with
// one open — gives the sidebar back without anybody having to remember to.
export function useWholeScreen(): void {
    setTaken((n) => n + 1)
    onCleanup(() => setTaken((n) => n - 1))
}
