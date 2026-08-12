import {createEffect} from 'solid-js'
import type {JSX} from 'solid-js'

import {EditableProps, useEditable} from './editable'

import './editableArea.scss'

function getBorderWidth(style: CSSStyleDeclaration): number {
    return parseInt(style.borderTopWidth || '0', 10) + parseInt(style.borderBottomWidth || '0', 10)
}

const EditableArea = (props: EditableProps): JSX.Element => {
    let elementRef: HTMLTextAreaElement | undefined
    let referenceRef: HTMLTextAreaElement | undefined
    let height = 0
    const elementProps = useEditable(props, () => elementRef)

    // The hidden reference textarea carries the same value; whenever that
    // value changes, its scrollHeight is what the visible one grows to.
    createEffect(() => {
        void props.value
        if (!elementRef || !referenceRef) {
            return
        }

        const nextHeight = referenceRef.scrollHeight
        const textarea = elementRef

        if (nextHeight > 0 && nextHeight !== height) {
            const style = getComputedStyle(textarea)
            const borderWidth = getBorderWidth(style)

            // Directly change the height to avoid circular rerenders
            textarea.style.height = String(nextHeight + borderWidth) + 'px'

            height = nextHeight
        }
    })

    return (
        <div class={'EditableAreaWrap'}>
            <textarea
                {...elementProps}
                rows={1}
                ref={elementRef}
                class={'EditableArea ' + elementProps.class}
            />
            <div class={'EditableAreaContainer'}>
                <textarea
                    ref={referenceRef}
                    class={'EditableAreaReference ' + elementProps.class}
                    dir='auto'
                    disabled={true}
                    rows={1}
                    value={elementProps.value}
                    aria-hidden={true}
                />
            </div>
        </div>
    )
}

export default EditableArea
