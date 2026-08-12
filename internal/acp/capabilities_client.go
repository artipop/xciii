package acp

import acpsdk "github.com/coder/acp-go-sdk"

// clientCapabilities is what we tell an agent this client can do.
//
// Form elicitation is claimed, and the claude adapter reads that as permission
// to leave AskUserQuestion enabled: an agent that needs a decision asks for it,
// and the question lands on the card it is working (question.go). URL mode is
// not claimed — it sends a person to a browser to finish something there, and a
// board that is itself where the work happens has nowhere to put that.
func clientCapabilities() acpsdk.ClientCapabilities {
	return acpsdk.ClientCapabilities{
		Fs:          acpsdk.FileSystemCapabilities{ReadTextFile: true, WriteTextFile: true},
		Elicitation: &acpsdk.ElicitationCapabilities{Form: &acpsdk.ElicitationFormCapabilities{}},
	}
}
