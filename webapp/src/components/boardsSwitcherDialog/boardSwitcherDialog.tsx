import {Show, createEffect, createSignal, onCleanup} from 'solid-js'
import type {JSX} from 'solid-js'

import './boardSwitcherDialog.scss'

import {useNavigate} from '@solidjs/router'

import {useIntl} from '../../intl'

import octoClient from '../../octoClient'
import SearchDialog from '../searchDialog/searchDialog'
import Globe from '../../widgets/icons/globe'
import LockOutline from '../../widgets/icons/lockOutline'
import {useAppSelector} from '../../store/hooks'
import {useRouteMatch} from '../../hooks/routerMatch'
import {getAllTeams, getCurrentTeam, Team} from '../../store/teams'
import {getMe} from '../../store/users'
import {Utils} from '../../utils'
import {BoardTypeOpen, BoardTypePrivate} from '../../blocks/board'
import {Constants} from '../../constants'

type Props = {
    onClose: () => void
}

const BoardSwitcherDialog = (props: Props): JSX.Element => {
    const [selected, setSelected] = createSignal<number>(-1)
    const elements: Array<HTMLDivElement | undefined> = []
    const [ids, setIds] = createSignal<Record<number, [string, string]>>({})
    const intl = useIntl()
    const team = useAppSelector(getCurrentTeam)
    const me = useAppSelector(getMe)
    const allTeams = useAppSelector(getAllTeams)
    const title = intl.formatMessage({id: 'FindBoardsDialog.Title', defaultMessage: 'Find Boards'})
    const subTitle = intl.formatMessage(
        {
            id: 'FindBoardsDialog.SubTitle',
            defaultMessage: 'Type to find a board. Use <b>UP/DOWN</b> to browse. <b>ENTER</b> to select, <b>ESC</b> to dismiss',
        },
        {
            b: (...chunks: unknown[]) => <b>{chunks as never}</b>,
        },
    ) as JSX.Element

    const match = useRouteMatch()
    const navigate = useNavigate()

    const selectBoard = async (teamId: string, boardId: string): Promise<void> => {
        if (!me()) {
            return
        }
        const currentMatch = match()
        const newPath = Utils.generatePath(currentMatch.path, {...currentMatch.params, teamId, boardId, viewId: undefined})
        navigate(newPath)
        props.onClose()
    }

    const teamsById = (): Record<string, Team> => {
        const result: Record<string, Team> = {}
        allTeams().forEach((t) => {
            result[t.id] = t
        })
        return result
    }

    const searchHandler = async (query: string): Promise<JSX.Element[]> => {
        if (query.trim().length === 0 || !team()) {
            return []
        }

        const items = await octoClient.searchAll(query)
        const untitledBoardTitle = intl.formatMessage({id: 'ViewTitle.untitled-board', defaultMessage: 'Untitled board'})
        elements.length = items.length
        const byId = teamsById()
        return items.map((item, i) => {
            const resultTitle = item.title || untitledBoardTitle
            const teamTitle = byId[item.teamId].title
            setIds((prevIDs) => ({
                ...prevIDs,
                [i]: [item.teamId, item.id],
            }))
            return (
                <div
                    class='blockSearchResult'
                    onClick={() => selectBoard(item.teamId, item.id)}
                    ref={(el) => {
                        elements[i] = el
                    }}
                >
                    <Show when={item.type === BoardTypeOpen}><Globe/></Show>
                    <Show when={item.type === BoardTypePrivate}><LockOutline/></Show>
                    <span class='resultTitle'>{resultTitle}</span>
                    <span class='teamTitle'>{teamTitle}</span>
                </div>
            )
        })
    }

    const handleEnterKeyPress = (e: KeyboardEvent) => {
        if (Utils.isKeyPressed(e, Constants.keyCodes.ENTER) && selected() > -1) {
            e.preventDefault()
            const [teamId, id] = ids()[selected()]
            selectBoard(teamId, id)
        }
    }

    createEffect(() => {
        if (selected() >= 0) {
            elements[selected()]?.parentElement?.focus()
        }

        document.addEventListener('keydown', handleEnterKeyPress)

        // cleanup function
        onCleanup(() => {
            document.removeEventListener('keydown', handleEnterKeyPress)
        })
    })

    return (
        <SearchDialog
            onClose={props.onClose}
            title={title}
            subTitle={subTitle}
            searchHandler={searchHandler}
            selected={selected()}
            setSelected={(n: number) => setSelected(n)}
        />
    )
}

export default BoardSwitcherDialog
