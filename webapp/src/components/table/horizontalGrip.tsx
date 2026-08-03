// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import {useColumnResize} from './tableColumnResizeContext'
import './horizontalGrip.scss'

type Props = {
    templateId: string
    columnWidth: number
    onAutoSizeColumn: (columnID: string) => void
}

type OffsetCallback = (offset: number) => void

function useResizable(liveOffset: OffsetCallback, finalOffset: OffsetCallback) {
    const state = {
        initialX: 0,
        lastOffset: 0,
        isResizing: false,
    }

    const updateOffset = (event: MouseEvent) => {
        state.lastOffset = event.clientX - state.initialX
        liveOffset(state.lastOffset)
    }

    const stopResizing = () => {
        if (state.isResizing) {
            state.isResizing = false
            document.removeEventListener('mousemove', updateOffset)
            document.removeEventListener('mouseup', stopResizing)
            document.body.style.userSelect = ''
            finalOffset(state.lastOffset)
        }
    }

    onCleanup(stopResizing)

    return (event: MouseEvent) => {
        state.initialX = event.clientX
        state.lastOffset = 0
        state.isResizing = true
        document.addEventListener('mousemove', updateOffset)
        document.addEventListener('mouseup', stopResizing)
        document.body.style.userSelect = 'none'
        event.preventDefault()
    }
}

const HorizontalGrip = (props: Props): JSX.Element => {
    const columnResize = useColumnResize()

    const liveOffset = (offset: number) => {
        columnResize.updateOffset(props.templateId, offset)
    }

    const finalOffset = (offset: number) => {
        const width = columnResize.width(props.templateId) + offset
        columnResize.updateWidth(props.templateId, width)
    }

    const startResize = useResizable(liveOffset, finalOffset)

    return (
        <div
            class='HorizontalGrip'
            onDblClick={() => props.onAutoSizeColumn(props.templateId)}
            onMouseDown={startResize}
        />
    )
}

export default HorizontalGrip
