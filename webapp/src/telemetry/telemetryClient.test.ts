import '@testing-library/jest-dom'

import TelemetryClient from './telemetryClient'

describe('trackEvent', () => {
    const track = vi.fn()
    const page = vi.fn()
    test('should call Rudder\'s track when a RudderTelemetryHandler is attached to TelemetryClient', () => {
        TelemetryClient.setTelemetryHandler()
        TelemetryClient.trackEvent('test', 'onClick')
        TelemetryClient.pageVisited('boards', 'test')
        expect(track).not.toHaveBeenCalled()
        expect(page).not.toHaveBeenCalled()

        TelemetryClient.setTelemetryHandler({trackEvent: track, pageVisited: page})
        TelemetryClient.trackEvent('test', 'onClick')
        TelemetryClient.pageVisited('boards', 'test')

        expect(track).toHaveBeenCalledTimes(1)
        expect(page).toHaveBeenCalledTimes(1)
    })
})
