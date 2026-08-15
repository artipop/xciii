package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/artipop/xciii/internal/acp"
)

// This binary, re-invoked as the hook an agent's CLI runs when it needs a
// person (internal/acp/toolhook.go says why that exists at all).
//
// It is a subcommand rather than a helper on disk for the same reason
// maybeRunMCP is one: a second artifact would have to be installed, found on
// PATH and kept in step with the app that reads its output. All it does is carry
// the question to the app that owns the board and carry the decision back.
//
// **Silence is a valid answer here, and it is the one every failure gives.** The
// app is not running, the front door moved, the grant expired, the person never
// looked: in every case this prints nothing and exits 0, and the CLI falls back
// to the box it already drew on its own screen. Exiting non-zero, or printing
// something the CLI cannot parse, would turn "nobody answered on the card" into
// a broken agent — and the whole arrangement is meant to add a place to answer,
// never to take one away.

// hookCallTimeout bounds the whole round trip. Longer than the app's own hold
// (acp.hookHold) so the answer arrives rather than being cut off here, and
// shorter than the timeout the CLI was given, so this exits before it is killed.
const hookCallTimeout = 75 * time.Second

// maybeRunHook answers a hook call and exits, or returns if this launch is the
// app itself. Called from main() beside maybeRunMCP.
func maybeRunHook(args []string) {
	if len(args) == 0 || args[0] != acp.HookArg {
		return
	}
	if len(args) < 3 {
		// Nothing to say to the CLI: no address means no question was ever put.
		fmt.Fprintf(os.Stderr, "usage: xciii %s <origin> <token>\n", acp.HookArg)
		os.Exit(0)
	}
	if out := askApp(args[1], args[2]); len(out) > 0 {
		os.Stdout.Write(out)
	}
	os.Exit(0)
}

// askApp puts what arrived on stdin to the running app and returns what the CLI
// should be told. Every error is an empty answer: see the note above.
func askApp(origin, token string) []byte {
	raw, err := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
	if err != nil || len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	ask, err := acp.ParseClaudeHook(raw)
	if err != nil {
		return nil
	}
	body, err := json.Marshal(ask)
	if err != nil {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), hookCallTimeout)
	defer cancel()

	url := strings.TrimSuffix(origin, "/") + acp.HookPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var decision acp.ToolDecision
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&decision); err != nil {
		return nil
	}
	out, err := acp.ClaudeHookOutput(decision)
	if err != nil {
		return nil
	}
	return out
}
