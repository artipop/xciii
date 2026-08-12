import {render, screen, waitFor} from '@solidjs/testing-library'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'

import {wrapIntl} from '../../testUtils'

import ProxiesPanel, {isProxiesAvailable} from './proxiesPanel'

const anyWindow = window as any

describe('components/acp/proxiesPanel', () => {
    afterEach(() => {
        delete anyWindow.go
        vi.clearAllMocks()
    })

    test('isProxiesAvailable is false without desktop bindings', () => {
        expect(isProxiesAvailable()).toBe(false)
    })

    test('lists configurations and adds one', async () => {
        const bindings = {
            ListProxies: vi.fn().mockResolvedValue(JSON.stringify([
                {name: 'office', proxy: 'http://proxy.example.com:8080'},
            ])),
            AddProxy: vi.fn().mockResolvedValue(JSON.stringify({name: 'lab'})),
            UpdateProxy: vi.fn(),
            RemoveProxy: vi.fn(),
        }
        anyWindow.go = {main: {App: bindings}}
        expect(isProxiesAvailable()).toBe(true)

        render(() => wrapIntl(() => <ProxiesPanel/>))
        await waitFor(() => expect(screen.getByText('office')).toBeInTheDocument())
        expect(screen.getByText('http://proxy.example.com:8080')).toBeInTheDocument()

        userEvent.click(screen.getByRole('button', {name: 'Add configuration…'}))
        await waitFor(() => expect(screen.getByPlaceholderText('http://proxy.example.com:8080')).toBeInTheDocument())

        userEvent.type(screen.getByPlaceholderText('Name (shown in the agent\'s proxy list)'), 'lab')
        userEvent.type(screen.getByPlaceholderText('http://proxy.example.com:8080'), 'socks5://127.0.0.1:1080')
        userEvent.type(screen.getByPlaceholderText('localhost,127.0.0.1,.internal'), '.internal')
        userEvent.type(screen.getByPlaceholderText('/etc/ssl/my-ca.pem'), '/etc/ssl/my-ca.pem')

        userEvent.click(screen.getByRole('button', {name: 'Save'}))
        await waitFor(() => expect(bindings.AddProxy).toHaveBeenCalled())
        expect(JSON.parse(bindings.AddProxy.mock.calls[0][0])).toMatchObject({
            name: 'lab',
            proxy: 'socks5://127.0.0.1:1080',
            noProxy: '.internal',
            caCert: '/etc/ssl/my-ca.pem',
        })
    })

    test('shows the backend error when a configuration is still in use', async () => {
        const bindings = {
            ListProxies: vi.fn().mockResolvedValue(JSON.stringify([{name: 'office', proxy: 'http://p:8080'}])),
            AddProxy: vi.fn(),
            UpdateProxy: vi.fn(),
            RemoveProxy: vi.fn().mockRejectedValue(new Error('используют агенты: claude-a')),
        }
        anyWindow.go = {main: {App: bindings}}

        render(() => wrapIntl(() => <ProxiesPanel/>))
        await waitFor(() => expect(screen.getByText('office')).toBeInTheDocument())

        userEvent.click(screen.getByRole('button', {name: 'Remove'}))
        await waitFor(() => expect(screen.getByText(/используют агенты: claude-a/)).toBeInTheDocument())
    })
})
