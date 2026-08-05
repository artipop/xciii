// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {Show} from 'solid-js'
import type {JSX} from 'solid-js'

import {IntlShape} from '../../intl'

import mutator from '../../mutator'
import Menu from '../../widgets/menu'
import MenuWrapper from '../../widgets/menuWrapper'
import ShowIcon from '../../widgets/icons/show'
import Label from '../../widgets/label'
import {Card} from '../../blocks/card'
import {BoardGroup} from '../../blocks/board'
import {BoardView} from '../../blocks/boardView'

import Button from '../../widgets/buttons/button'
import {useDropZone} from '../../hooks/sortable'

type Props = {
    activeView: BoardView
    group: BoardGroup
    intl: IntlShape
    readonly: boolean
    onDrop: (card: Card) => void
}

export default function KanbanHiddenColumnItem(props: Props): JSX.Element {
    const hiddenCardGroupId = 'hidden-card-group-id'

    const [isOver, drop] = useDropZone<Card>('card', () => true, (card) => props.onDrop(card))

    const classes = () => {
        let name = 'octo-board-hidden-item'
        if (isOver()) {
            name += ' dragover'
        }
        return name
    }

    return (
        <div
            ref={drop}
            class={classes()}
        >
            <MenuWrapper
                disabled={props.readonly}
                menu={
                    <Menu>
                        <Menu.Text
                            id='show'
                            icon={<ShowIcon/>}
                            name={props.intl.formatMessage({id: 'BoardComponent.show', defaultMessage: 'Show'})}
                            onClick={() => mutator.unhideViewColumn(props.activeView.boardId, props.activeView, props.group.option.id)}
                        />
                    </Menu>
                }
            >
                <Label
                    color={props.group.option.color}
                >
                    {props.group.option.value}
                </Label>
            </MenuWrapper>
            <Show
                when={props.group.option.id === hiddenCardGroupId}
                fallback={<Button>{`${props.group.cards.length}`}</Button>}
            >
                <Button title='hidden-card-count'>{`${props.group.cards.length}`}</Button>
            </Show>
        </div>
    )
}
