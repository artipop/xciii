// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// The Wails-generated Go bindings are PascalCase methods, not constructors.
/* eslint-disable new-cap */
import React, {useCallback, useEffect, useState} from 'react'
import {useIntl} from 'react-intl'

import Button from '../../widgets/buttons/button'
import Dialog from '../dialog'

import {agentBindings} from './agentReposDialog'

import './planningDialog.scss'

// Planning a task before it exists: the agent's own CLI, in the repository, in
// a window.
//
// This dialog used to hold the conversation itself — a transcript, a prompt box
// and a "create task" turn that boiled the discussion down into a card. The
// conversation now happens where the agent already has a good one, in its
// terminal, so what is left here is choosing where to open it and finding the
// ones already open: a terminal outlives its window, and one with no card
// behind it has nothing else to be found through.

type NamedEntry = {name: string}
type LiveTerminal = {id: string, agent: string, cwd: string}

export function isPlanningAvailable(): boolean {
    return Boolean(agentBindings()?.OpenPlanningTerminal)
}

type Props = {
    onClose: () => void
}

const PlanningDialog = (props: Props) => {
    const intl = useIntl()
    const bindings = agentBindings()

    const [repos, setRepos] = useState<NamedEntry[]>([])
    const [agents, setAgents] = useState<NamedEntry[]>([])
    const [repoName, setRepoName] = useState('')
    const [agentName, setAgentName] = useState('')
    const [terminals, setTerminals] = useState<LiveTerminal[]>([])
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    useEffect(() => {
        const load = async () => {
            if (!bindings) {
                return
            }
            try {
                const [repoList, agentList] = await Promise.all([
                    bindings.ListAgentRepos(),
                    bindings.ListAgents(),
                ])
                const parsedRepos: NamedEntry[] = JSON.parse(repoList) || []
                const parsedAgents: NamedEntry[] = JSON.parse(agentList) || []
                setRepos(parsedRepos)
                setAgents(parsedAgents)

                // One of a kind needs no choosing.
                if (parsedRepos.length === 1) {
                    setRepoName(parsedRepos[0].name)
                }
                if (parsedAgents.length === 1) {
                    setAgentName(parsedAgents[0].name)
                }
            } catch (e: any) {
                setError(String(e?.message || e))
            }
        }
        load()
    }, [bindings])

    const refreshTerminals = useCallback(async () => {
        if (!bindings?.ListTerminals) {
            return
        }
        try {
            const all = JSON.parse(await bindings.ListTerminals())
            setTerminals(all.filter((t: {cardId?: string}) => !t.cardId))
        } catch (e) {
            // Nothing running is the ordinary case, not a failure.
        }
    }, [bindings])

    useEffect(() => {
        refreshTerminals()
    }, [refreshTerminals])

    // The desktop app has already opened the window by the time the binding
    // returns; a server build has no windows, so the browser opens a tab.
    const openWindow = useCallback((handle: {windowed?: boolean, url?: string}) => {
        if (!handle.windowed && handle.url) {
            window.open(handle.url, '_blank', 'noopener')
        }
    }, [])

    const start = useCallback(async () => {
        if (!bindings?.OpenPlanningTerminal) {
            return
        }
        setError('')
        setBusy(true)
        try {
            openWindow(JSON.parse(await bindings.OpenPlanningTerminal(repoName, agentName)))
            await refreshTerminals()
        } catch (e: any) {
            setError(String(e?.message || e))
        } finally {
            setBusy(false)
        }
    }, [agentName, bindings, openWindow, refreshTerminals, repoName])

    const show = useCallback(async (id: string) => {
        if (!bindings?.ShowTerminal) {
            return
        }
        try {
            openWindow(JSON.parse(await bindings.ShowTerminal(id)))
        } catch (e: any) {
            setError(String(e?.message || e))
            refreshTerminals()
        }
    }, [bindings, openWindow, refreshTerminals])

    return (
        <Dialog
            onClose={props.onClose}
            className='PlanningDialog'
            title={<div>{intl.formatMessage({id: 'Planning.title', defaultMessage: 'Plan a task'})}</div>}
        >
            <div className='PlanningDialog__body'>
                <p className='PlanningDialog__hint'>
                    {intl.formatMessage({
                        id: 'Planning.hint-terminal',
                        defaultMessage: 'Opens the agent\'s CLI in the repository. Nothing is committed for you and no card is created — this is a place to think out loud.',
                    })}
                </p>

                <div className='PlanningDialog__pickers'>
                    <label>
                        {intl.formatMessage({id: 'Planning.repository', defaultMessage: 'Repository'})}
                        <select
                            value={repoName}
                            onChange={(e) => setRepoName(e.target.value)}
                        >
                            <option value=''>{intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})}</option>
                            {repos.map((r) => (
                                <option
                                    key={r.name}
                                    value={r.name}
                                >{r.name}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        {intl.formatMessage({id: 'Planning.agent', defaultMessage: 'Agent'})}
                        <select
                            value={agentName}
                            onChange={(e) => setAgentName(e.target.value)}
                        >
                            <option value=''>{intl.formatMessage({id: 'Planning.choose', defaultMessage: 'Choose…'})}</option>
                            {agents.map((a) => (
                                <option
                                    key={a.name}
                                    value={a.name}
                                >{a.name}</option>
                            ))}
                        </select>
                    </label>
                    <Button
                        filled={true}
                        onClick={start}
                        disabled={busy || !agentName || !repoName}
                    >
                        {intl.formatMessage({id: 'Planning.start-terminal', defaultMessage: 'Open a terminal'})}
                    </Button>
                </div>

                {error && <div className='PlanningDialog__error'>{error}</div>}

                {terminals.length > 0 &&
                    <div className='Planning__terminals'>
                        <span>{intl.formatMessage({id: 'Planning.terminals-running', defaultMessage: 'Terminals still running:'})}</span>
                        {terminals.map((t) => (
                            <Button
                                key={t.id}
                                onClick={() => show(t.id)}
                                title={t.cwd}
                            >
                                {`${t.agent} · ${t.cwd.split('/').pop()}`}
                            </Button>
                        ))}
                    </div>}
            </div>
        </Dialog>
    )
}

export default PlanningDialog
