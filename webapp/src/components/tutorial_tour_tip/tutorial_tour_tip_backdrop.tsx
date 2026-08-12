import {Show} from 'solid-js'

export type Coords = {
    x?: string
    y?: string
}
export type TutorialTourTipPunchout = Coords & {
    width?: string
    height?: string
    handleClick?: (e: MouseEvent) => void
}

const TutorialTourTipBackdrop = (props: TutorialTourTipPunchout) => {
    // The box moves with the element it highlights, so it is read on every
    // change rather than measured once. (A clip-path polygon used to be built
    // here from the same numbers and never reached the DOM; it is gone.)
    return (
        <Show when={props.x && props.y && props.width && props.height}>
            <div
                class={'tip-backdrop'}
                style={{
                    left: props.x,
                    top: props.y,
                    width: props.width,
                    height: props.height,
                }}
                onClick={props.handleClick}
            />
        </Show>
    )
}

export default TutorialTourTipBackdrop
