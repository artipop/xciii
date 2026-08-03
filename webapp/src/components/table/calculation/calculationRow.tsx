// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {For, createMemo, createSignal} from 'solid-js'
import type {JSX} from 'solid-js'

import {Constants} from '../../../constants'

import './calculationRow.scss'
import {Board, IPropertyTemplate} from '../../../blocks/board'

import mutator from '../../../mutator'
import Calculation from '../../calculations/calculation'
import {BoardView} from '../../../blocks/boardView'
import {Card} from '../../../blocks/card'
import {Options} from '../../calculations/options'

import {TableCalculationOptions} from './tableCalculationOptions'

type Props = {
    board: Board
    cards: Card[]
    activeView: BoardView
    readonly: boolean
}

const CalculationRow = (props: Props): JSX.Element => {
    const [showOptions, setShowOptions] = createSignal<Map<string, boolean>>(new Map<string, boolean>())
    const toggleOptions = (templateId: string, show: boolean) => {
        const newShowOptions = new Map<string, boolean>(showOptions())
        newShowOptions.set(templateId, show)
        setShowOptions(newShowOptions)
    }

    const titleTemplate: IPropertyTemplate = {
        id: Constants.titleColumnId,
    } as IPropertyTemplate

    const visiblePropertyTemplates = createMemo(() => ([
        titleTemplate,
        ...props.activeView.fields.visiblePropertyIds.map((id) => props.board.cardProperties.find((t) => t.id === id)).filter((i) => i) as IPropertyTemplate[],
    ]))

    const selectedCalculations = () => props.activeView.fields.columnCalculations || []

    const [hovered, setHovered] = createSignal(false)

    return (
        <div
            class={'CalculationRow octo-table-row'}
            onMouseEnter={() => setHovered(!props.readonly)}
            onMouseLeave={() => setHovered(false)}
        >
            <For each={visiblePropertyTemplates()}>
                {(template) => {
                    const defaultValue = template.id === Constants.titleColumnId ? Options.count.value : Options.none.value
                    const value = () => selectedCalculations()[template.id] || defaultValue

                    return (
                        <Calculation
                            class={`octo-table-cell ${props.readonly ? 'disabled' : ''}`}
                            value={value()}
                            menuOpen={Boolean(props.readonly ? false : showOptions().get(template.id))}
                            onMenuClose={() => toggleOptions(template.id, false)}
                            onMenuOpen={() => toggleOptions(template.id, true)}
                            onChange={(v: string) => {
                                const calculations = {...selectedCalculations()}
                                calculations[template.id] = v
                                mutator.changeViewColumnCalculations(props.board.id, props.activeView.id, selectedCalculations(), calculations, 'change column calculation')
                                setHovered(false)
                            }}
                            cards={props.cards}
                            property={template}
                            hovered={hovered()}
                            optionsComponent={TableCalculationOptions}
                        />
                    )
                }}
            </For>
        </div>
    )
}

export default CalculationRow
