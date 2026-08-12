import {ClientConfig} from '../config/clientConfig'

import {ShowUsername} from '../utils'

import type {StoreContext} from './context'

import type {RootState} from './index'

export type ClientConfigState = {value: ClientConfig}

const defaultClientConfig = (): ClientConfig => ({telemetry: false, telemetryid: '', enablePublicSharedBoards: false, teammateNameDisplay: ShowUsername, featureFlags: {}, maxFileSize: 0})

export const initialClientConfigState = (): ClientConfigState => ({value: defaultClientConfig()})

export const createClientConfigActions = ({setState, deps}: StoreContext) => ({
    setClientConfig(config: ClientConfig) {
        setState('clientConfig', 'value', config)
    },
    async fetchClientConfig(): Promise<void> {
        const config = await deps.client.getClientConfig()
        setState('clientConfig', 'value', config || defaultClientConfig())
    },
})

export function getClientConfig(state: RootState): ClientConfig {
    return state.clientConfig.value
}
