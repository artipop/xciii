// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// agentBindings returns the Wails-injected ACP bindings, or undefined in
// browser/plugin deployments (mirrors the webSocketBaseURL guard pattern).
//
// It lives in a module of its own because every ACP component needs it and none
// of them needs the others: it used to be exported from the projects dialog,
// which made that file a dependency of the whole feature for one line.
export function agentBindings() {
    return (window as unknown as import('../../types').IAppWindow).go?.main?.App
}
