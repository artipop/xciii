// Package imapsource is the IMAP source plugin. It ships inside this app's
// own binary and is started as `xciii sourceplugin imap` — the same trick
// internal/sources/kaiten plays for an MCP server, played here for a plugin
// speaking sources/protocol directly, because polling a mailbox with a
// cursor is exactly what that protocol is for (docs/sources.md §9–§11).
//
// Like every plugin, it does one thing — it returns items — and knows
// nothing of boards, cards or rules (docs/sources.md §8).
package imapsource

import (
	"context"

	// Registers message.CharsetReader for the encodings a mail server still
	// sends (windows-1251 and the like), so a Cyrillic message decodes
	// instead of turning to mojibake in the card it becomes.
	_ "github.com/emersion/go-message/charset"

	"github.com/artipop/xciii/sources/protocol"
	"github.com/artipop/xciii/sources/sdk"
)

// PluginName is both the manifest's second argument and what
// `xciii sourceplugin` dispatches on.
const PluginName = "imap"

// Plugin is the source, wired to a real IMAP server. sdk.Serve runs it.
func Plugin() sdk.Source {
	return sdk.Source{
		Capabilities: protocol.Capabilities{Poll: true, Cursor: true, Auth: "token"},
		Poll: func(ctx context.Context, req sdk.PollRequest) (sdk.PollResult, error) {
			return poll(ctx, dialIMAP, req)
		},
	}
}
