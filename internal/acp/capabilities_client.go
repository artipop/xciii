// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package acp

import acpsdk "github.com/coder/acp-go-sdk"

// clientCapabilities is what we tell an agent this client can do.
//
// It no longer claims elicitation. An agent asks a question through it, and
// there is nobody here to answer: the automation runs unattended, and a person
// who wants to be asked opens a terminal, where the agent asks in its own UI.
// The claude adapter reads this exactly that way — with no form capability it
// passes --disallowedTools AskUserQuestion to the CLI, so the agent states its
// question in the answer instead of waiting for a dialog that will never open.
func clientCapabilities() acpsdk.ClientCapabilities {
	return acpsdk.ClientCapabilities{
		Fs: acpsdk.FileSystemCapabilities{ReadTextFile: true, WriteTextFile: true},
	}
}
