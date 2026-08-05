// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {createContext, useContext} from 'solid-js'
import type {JSX, ParentComponent} from 'solid-js'

import {Constants} from '../../constants'

export type ColumnResizeContextType = {
    updateRef: (cardId: string, columnId: string, element: HTMLDivElement | null) => void
    cellRef: (columnId: string) => HTMLDivElement | undefined
    width: (columnId: string) => number
    updateOffset: (columnId: string, offset: number) => void
    updateWidth: (columnId: string, width: number) => void
}

const ColumnResizeContext = createContext<ColumnResizeContextType | null>(null)

export function useColumnResize(): ColumnResizeContextType {
    const context = useContext(ColumnResizeContext)
    if (!context) {
        throw new Error('ColumnResizeContext is not available!')
    }
    return context
}

export type ColumnResizeProviderProps = {
    columnWidths: Record<string, number>
    onResizeColumn: (columnId: string, width: number) => void
}

const columnWidth = (columnId: string, columnWidths: Record<string, number>, offset: number): string => {
    return `${Math.max(Constants.minColumnWidth, (columnWidths[columnId] || 0) + offset)}px`
}

export const ColumnResizeProvider: ParentComponent<ColumnResizeProviderProps> = (props): JSX.Element => {
    type ElementsMap = Map<string, HTMLDivElement>
    const columns = new Map<string, ElementsMap>()

    const updateWidth = (columnId: string, elements: ElementsMap, offset: number) => {
        const width = columnWidth(columnId, props.columnWidths, offset)
        for (const element of elements.values()) {
            element.style.width = width
        }
    }

    const contextValue: ColumnResizeContextType = {
        updateRef: (cardId, columnId, element) => {
            let elements = columns.get(columnId)
            if (element) {
                if (!elements) {
                    elements = new Map()
                    columns.set(columnId, elements)
                }
                elements.set(cardId, element)
            } else if (elements) {
                elements.delete(cardId)
            }
        },
        cellRef: (columnId): HTMLDivElement | undefined => {
            const iter = columns.get(columnId)?.values()
            if (iter) {
                const {value, done} = iter.next()
                return done ? value : iter.next().value
            }
            return undefined
        },
        width: (columnId) => {
            return Math.max(Constants.minColumnWidth, (props.columnWidths[columnId] || 0))
        },
        updateOffset: (columnId, offset) => {
            const elements = columns.get(columnId)
            if (elements) {
                updateWidth(columnId, elements, offset)
            }
        },
        updateWidth: (columnId, width) => {
            props.onResizeColumn(columnId, width)
        },
    }

    return (
        <ColumnResizeContext.Provider value={contextValue}>
            {props.children}
        </ColumnResizeContext.Provider>
    )
}
