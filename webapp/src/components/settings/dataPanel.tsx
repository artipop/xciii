import {For, Show} from 'solid-js'
import {Dynamic} from 'solid-js/web'
import type {Component} from 'solid-js'

import {useIntl} from '../../intl'

import {Archiver} from '../../archiver'
import {Constants} from '../../constants'
import {useAppSelector} from '../../store/hooks'
import {getCurrentTeam, Team} from '../../store/teams'
import Button from '../../widgets/buttons/button'
import CompassIcon from '../../widgets/icons/compassIcon'
import TrelloIcon from '../../widgets/icons/brands/trello'
import NotionIcon from '../../widgets/icons/brands/notion'
import TodoistIcon from '../../widgets/icons/brands/todoist'
import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import './dataPanel.scss'

// The archive is the whole install, not a board: it carries every board there
// is, which is why it belongs to the settings of the app and not to a board's
// own menu. One board leaves through that menu instead — "export board archive"
// on the board in the sidebar — and this panel says so rather than growing a
// second half-answer to the same question.

// Keyed by the entry's id, which is what `Constants.imports` records; a service
// this app has never heard of simply gets the generic mark.
const brandIcons: Record<string, Component> = {
    trello: TrelloIcon,
    notion: NotionIcon,
    todoist: TodoistIcon,
}

const DataPanel = () => {
    const intl = useIntl()
    const currentTeam = useAppSelector<Team|null>(getCurrentTeam)

    return (
        <div class='DataPanel'>
            <div class='DataPanel__subtitle'>
                {intl.formatMessage({
                    id: 'Settings.data-subtitle',
                    defaultMessage: 'An archive takes every board on this install. A single board is exported from its own ⋯ menu in the list of boards.',
                })}
            </div>

            <div class='DataPanel__content'>
                <div class='DataPanel__action'>
                    <div class='DataPanel__actionText'>
                        <span class='DataPanel__actionName'>
                            {intl.formatMessage({id: 'Sidebar.export-archive', defaultMessage: 'Export archive'})}
                        </span>
                        <span class='DataPanel__actionHint'>
                            {intl.formatMessage({
                                id: 'Settings.export-hint',
                                defaultMessage: 'Every board, its cards and its files in one .boardarchive file.',
                            })}
                        </span>
                    </div>
                    <Button
                        onClick={async () => {
                            const team = currentTeam()
                            if (!team) {
                                return
                            }
                            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ExportArchive)
                            Archiver.exportFullArchive(team.id)
                        }}
                    >
                        {intl.formatMessage({id: 'Settings.export', defaultMessage: 'Export'})}
                    </Button>
                </div>

                <div class='DataPanel__action'>
                    <div class='DataPanel__actionText'>
                        <span class='DataPanel__actionName'>
                            {intl.formatMessage({id: 'Sidebar.import-archive', defaultMessage: 'Import archive'})}
                        </span>
                        <span class='DataPanel__actionHint'>
                            {intl.formatMessage({
                                id: 'Settings.import-hint',
                                defaultMessage: 'The boards an archive carries are added beside the ones already here — nothing is replaced.',
                            })}
                        </span>
                    </div>
                    <Button
                        onClick={async () => {
                            TelemetryClient.trackEvent(TelemetryCategory, TelemetryActions.ImportArchive)
                            Archiver.importFullArchive()
                        }}
                    >
                        {intl.formatMessage({id: 'Settings.import', defaultMessage: 'Import'})}
                    </Button>
                </div>

                <Show when={Constants.imports.length > 0}>
                    <div class='DataPanel__group'>
                        <h4 class='DataPanel__groupTitle'>
                            {intl.formatMessage({id: 'Settings.from-elsewhere', defaultMessage: 'From another service'})}
                        </h4>
                        <p class='DataPanel__groupHint'>
                            {intl.formatMessage({
                                id: 'Settings.from-elsewhere-hint',
                                defaultMessage: 'Each of these is exported from the service itself and turned into an archive, which is then imported above.',
                            })}
                        </p>
                        <div class='DataPanel__brands'>
                            <For each={Constants.imports}>
                                {(entry) => (
                                    <button
                                        type='button'
                                        class='DataPanel__brand'
                                        onClick={() => {
                                            TelemetryClient.trackEvent(TelemetryCategory, entry.telemetryName)
                                            window.open(entry.href)
                                        }}
                                    >
                                        <span class='DataPanel__brandIcon'>
                                            <Show
                                                when={brandIcons[entry.id]}
                                                fallback={<CompassIcon icon='import'/>}
                                            >
                                                {(icon) => <Dynamic component={icon()}/>}
                                            </Show>
                                        </span>
                                        <span class='DataPanel__brandName'>{entry.displayName}</span>
                                        <CompassIcon
                                            icon='open-in-new'
                                            class='DataPanel__brandAway'
                                        />
                                    </button>
                                )}
                            </For>
                        </div>
                    </div>
                </Show>
            </div>
        </div>
    )
}

export default DataPanel
