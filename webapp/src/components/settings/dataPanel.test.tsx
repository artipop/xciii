// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.
import {render, screen} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {mockAppStore, wrapIntl} from '../../testUtils'
import {AppStoreProvider} from '../../store'
import {Archiver} from '../../archiver'
import {Constants} from '../../constants'
import TelemetryClient, {TelemetryCategory, TelemetryActions} from '../../telemetry/telemetryClient'

import DataPanel from './dataPanel'

vi.mock('../../telemetry/telemetryClient')
const mockedTelemetry = vi.mocked(TelemetryClient)

describe('components/settings/dataPanel', () => {
    const store = mockAppStore({teams: {current: {id: 'team-id'}}})

    let exportFull: ReturnType<typeof vi.spyOn>
    let importFull: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        exportFull = vi.spyOn(Archiver, 'exportFullArchive').mockResolvedValue()
        importFull = vi.spyOn(Archiver, 'importFullArchive').mockResolvedValue()
        window.open = vi.fn()
    })

    const open = () => render(() => wrapIntl(() =>
        <AppStoreProvider store={store}>
            <DataPanel/>
        </AppStoreProvider>,
    ))

    // An archive is every board there is, which is why it is a setting of the
    // app and not an entry in one board's menu.
    test('sends every board of this install out as one archive', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Export'}))

        expect(exportFull).toHaveBeenCalledWith('team-id')
    })

    test('brings an archive back in', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Import'}))

        expect(importFull).toHaveBeenCalled()
    })

    // Coming from another service is not an import this app performs: the
    // service is exported on its own side and what comes back is an archive.
    // The row says where that is written down, and nothing more.
    test('sends somebody coming from another service to what it takes', () => {
        open()

        userEvent.click(screen.getByRole('button', {name: 'Trello'}))

        expect(window.open).toHaveBeenCalledWith(Constants.imports[0].href)
        expect(mockedTelemetry.trackEvent).toHaveBeenCalledWith(TelemetryCategory, TelemetryActions.ImportTrello)
    })

    test('offers every service it has instructions for', () => {
        open()

        for (const entry of Constants.imports) {
            expect(screen.getByRole('button', {name: entry.displayName})).toBeInTheDocument()
        }
    })
})
