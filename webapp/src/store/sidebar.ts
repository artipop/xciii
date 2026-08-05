// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {batch} from 'solid-js'
import {produce} from 'solid-js/store'

import {Utils} from '../utils'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type CategoryType = 'system' | 'custom'

interface Category {
    id: string
    name: string
    userID: string
    teamID: string
    createAt: number
    updateAt: number
    deleteAt: number
    collapsed: boolean
    sortOrder: number
    type: CategoryType
    isNew: boolean
}

interface CategoryBoardMetadata {
    boardID: string
    hidden: boolean
}

interface CategoryBoards extends Category {
    boardMetadata: CategoryBoardMetadata[]
}

interface BoardCategoryWebsocketData {
    boardID: string
    categoryID: string
    hidden: boolean
}

interface CategoryBoardsReorderData {
    categoryID: string
    boardsMetadata: CategoryBoardMetadata[]
}

export const DefaultCategory: CategoryBoards = {
    id: '',
    name: 'Boards',
} as CategoryBoards

export type SidebarState = {
    categoryAttributes: CategoryBoards[]
    hiddenBoardIDs: string[]
}

export const initialSidebarState = (): SidebarState => ({categoryAttributes: [], hiddenBoardIDs: []})

export const createSidebarActions = ({setState, deps}: StoreContext) => ({
    updateCategories(categories: Category[]) {
        setState('sidebar', 'categoryAttributes', produce((categoryAttributes) => {
            categories.forEach((updatedCategory) => {
                const index = categoryAttributes.findIndex((c) => c.id === updatedCategory.id)

                // when new category got created,
                if (index === -1) {
                    // new categories should always show up on the top
                    categoryAttributes.unshift({
                        ...updatedCategory,
                        boardMetadata: [],
                        isNew: true,
                    })
                } else if (updatedCategory.deleteAt) {
                    // when category is deleted
                    categoryAttributes.splice(index, 1)
                } else {
                    // else all, update the category
                    categoryAttributes[index] = {
                        ...categoryAttributes[index],
                        name: updatedCategory.name,
                        updateAt: updatedCategory.updateAt,
                        isNew: false,
                    }
                }
            })
        }))
    },
    updateBoardCategories(boardCategories: BoardCategoryWebsocketData[]) {
        setState('sidebar', produce((sidebar) => {
            const updatedCategoryAttributes: CategoryBoards[] = []
            let updatedHiddenBoardIDs = sidebar.hiddenBoardIDs

            boardCategories.forEach((boardCategory) => {
                for (let i = 0; i < sidebar.categoryAttributes.length; i++) {
                    const categoryAttribute = sidebar.categoryAttributes[i]

                    if (categoryAttribute.id === boardCategory.categoryID) {
                        const categoryBoardMetadataIndex = categoryAttribute.boardMetadata.findIndex((boardMetadata) => boardMetadata.boardID === boardCategory.boardID)
                        if (categoryBoardMetadataIndex >= 0) {
                            categoryAttribute.boardMetadata[categoryBoardMetadataIndex] = {
                                ...categoryAttribute.boardMetadata[categoryBoardMetadataIndex],
                                hidden: boardCategory.hidden,
                            }
                        } else {
                            categoryAttribute.boardMetadata.unshift({boardID: boardCategory.boardID, hidden: boardCategory.hidden})
                            categoryAttribute.isNew = false
                        }
                    } else {
                        // remove the board from other categories
                        categoryAttribute.boardMetadata = categoryAttribute.boardMetadata.filter((metadata) => metadata.boardID !== boardCategory.boardID)
                    }

                    updatedCategoryAttributes[i] = categoryAttribute

                    if (boardCategory.hidden) {
                        if (updatedHiddenBoardIDs.indexOf(boardCategory.boardID) < 0) {
                            updatedHiddenBoardIDs.push(boardCategory.boardID)
                        }
                    } else {
                        updatedHiddenBoardIDs = updatedHiddenBoardIDs.filter((hiddenBoardID) => hiddenBoardID !== boardCategory.boardID)
                    }
                }
            })

            if (updatedCategoryAttributes.length > 0) {
                sidebar.categoryAttributes = updatedCategoryAttributes
            }
            sidebar.hiddenBoardIDs = updatedHiddenBoardIDs
        }))
    },
    updateCategoryOrder(categoryOrder: string[]) {
        if (categoryOrder.length === 0) {
            return
        }

        setState('sidebar', 'categoryAttributes', (categoryAttributes) => {
            const categoryById = new Map<string, CategoryBoards>()
            categoryAttributes.forEach((categoryBoards: CategoryBoards) => categoryById.set(categoryBoards.id, categoryBoards))

            const newOrderedCategories: CategoryBoards[] = []
            categoryOrder.forEach((categoryId) => {
                const category = categoryById.get(categoryId)
                if (!category) {
                    Utils.logError('Category ID from updated category order not found in store. CategoryID: ' + categoryId)
                    return
                }
                newOrderedCategories.push(category)
            })

            return newOrderedCategories
        })
    },
    updateCategoryBoardsOrder(reorderData: CategoryBoardsReorderData) {
        if (reorderData.boardsMetadata.length === 0) {
            return
        }

        setState('sidebar', 'categoryAttributes', produce((categoryAttributes) => {
            const categoryIndex = categoryAttributes.findIndex((categoryBoards) => categoryBoards.id === reorderData.categoryID)
            if (categoryIndex < 0) {
                Utils.logError('Category ID from updated category boards order not found in store. CategoryID: ' + reorderData.categoryID)
                return
            }

            const category = categoryAttributes[categoryIndex]
            categoryAttributes[categoryIndex] = {
                ...category,
                boardMetadata: reorderData.boardsMetadata,
                isNew: false,
            }
        }))
    },
    async fetchSidebarCategories(teamID: string): Promise<void> {
        const categoryAttributes = await deps.client.getSidebarCategories(teamID) || []
        batch(() => {
            setState('sidebar', 'categoryAttributes', categoryAttributes)
            setState('sidebar', 'hiddenBoardIDs', categoryAttributes.flatMap(
                (ca) => {
                    return ca.boardMetadata.reduce((collector, m) => {
                        if (m.hidden) {
                            collector.push(m.boardID)
                        }

                        return collector
                    }, [] as string[])
                },
            ))
        })
    },
})

export const getSidebarCategories = (state: RootState): CategoryBoards[] => state.sidebar.categoryAttributes

export const getHiddenBoardIDs = (state: RootState): string[] => state.sidebar.hiddenBoardIDs

export function getCategoryOfBoard(boardID: string): (state: RootState) => CategoryBoards | undefined {
    return (state: RootState) =>
        state.sidebar.categoryAttributes.find((category) => category.boardMetadata.findIndex((m) => m.boardID === boardID) >= 0)
}

export {type Category, type CategoryBoards, type BoardCategoryWebsocketData, type CategoryBoardsReorderData, type CategoryBoardMetadata}
