// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package acp

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// The grant is the whole of the door: the token names the board, so an agent
// that read its own environment still cannot write anywhere else.
func TestBoardToolsWriteOnlyToTheGrantedBoard(t *testing.T) {
	m, writer, _, _ := testManager(t, "idle", func(cfg *Config) {
		cfg.TriggerProperty = "Статус"
	})

	token := m.GrantBoardTools("board-1")
	if token == "" {
		t.Fatal("no token was minted")
	}

	id, err := m.CreateCardFromTools(t.Context(), token, NewCard{
		Title:   "Починить окно планирования",
		Body:    "Оно открывается пополам.",
		Column:  "К агенту",
		Options: []string{"xciii"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Error("the card was created without an id to point at")
	}

	if len(writer.created) != 1 {
		t.Fatalf("board writes: %d, want 1", len(writer.created))
	}
	got := writer.created[0]
	if got.BoardID != "board-1" {
		t.Errorf("card landed on board %q, want the granted one", got.BoardID)
	}
	// The column property is the config's, not the agent's: it names columns
	// and nothing else.
	if got.Property != "Статус" {
		t.Errorf("column property %q, want the configured one", got.Property)
	}
	if got.Column != "К агенту" || len(got.Options) != 1 {
		t.Errorf("card lost what was asked for: %+v", got)
	}
}

// A grant that outlived its agent run would be a door left open, so revoking is
// what closing a run means — and a card still needs a title.
func TestBoardToolsRefuseWhatTheyShould(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)

	if _, err := m.CreateCardFromTools(t.Context(), "not-a-token", NewCard{Title: "Задача"}); err == nil {
		t.Error("a made-up token opened the board")
	}

	token := m.GrantBoardTools("board-1")
	if _, err := m.CreateCardFromTools(t.Context(), token, NewCard{Title: "   "}); err == nil {
		t.Error("a card with no title was accepted")
	}

	m.RevokeBoardTools(token)
	if _, err := m.CreateCardFromTools(t.Context(), token, NewCard{Title: "Задача"}); err == nil {
		t.Error("a revoked grant still opened the board")
	}
	if err := m.CheckBoardTools(token); err == nil {
		t.Error("a revoked grant still checks out")
	}
}

// A terminal is the vendor CLI, so the tools reach it as a config file the CLI
// is pointed at — and the file carries the grant, so it goes when the grant does.
func TestBoardToolsConfigIsWrittenForTheCLIAndCleanedUpAfter(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	token, path := m.openBoardTools("board-1", AgentEntry{Name: "c", Kind: AgentKindClaude})
	if token == "" || path == "" {
		t.Fatal("claude takes an MCP config and got none")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		MCPServers map[string]struct {
			Command string            `json:"command"`
			Args    []string          `json:"args"`
			Env     map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatalf("the CLI would not read this config: %v\n%s", err, raw)
	}
	server, ok := config.MCPServers["board"]
	if !ok {
		t.Fatalf("no board server in the config: %s", raw)
	}
	if strings.Join(server.Args, " ") != "mcp board" {
		t.Errorf("server args %v, want our own binary re-invoked", server.Args)
	}
	if server.Env["XCIII_BOARD_TOKEN"] != token {
		t.Error("the server was not given the grant")
	}
	if server.Env["XCIII_BOARD_URL"] != "http://127.0.0.1:8088/" {
		t.Errorf("the server was pointed at %q", server.Env["XCIII_BOARD_URL"])
	}

	// And the argv the terminal runs is what that CLI takes.
	argv, err := terminalCommand(AgentEntry{Name: "c", Kind: AgentKindClaude}, false, path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(argv, " ") != "claude --mcp-config "+path {
		t.Errorf("argv %v, want the CLI pointed at the config", argv)
	}

	m.closeBoardTools(token, path)
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Error("the config outlived the terminal, and it holds a grant")
	}
	if err := m.CheckBoardTools(token); err == nil {
		t.Error("the grant outlived the terminal")
	}
}

// An agent whose CLI we cannot tell about MCP simply runs without the tools:
// guessing a flag is how a terminal fails to open at all.
func TestBoardToolsAreSkippedForACLIThatCannotTakeThem(t *testing.T) {
	m, _, _, _ := testManager(t, "idle", nil)
	m.SetOrigin("http://127.0.0.1:8088/")

	for _, agent := range []AgentEntry{
		{Name: "x", Kind: AgentKindCodex},
		{Name: "w", Kind: AgentKindClaude, TerminalCommand: []string{"proxychains4", "claude"}},
	} {
		if token, path := m.openBoardTools("board-1", agent); token != "" || path != "" {
			t.Errorf("%s was given tools it cannot be told about", agent.Name)
			m.closeBoardTools(token, path)
		}
	}

	// And a terminal with no board behind it has nowhere to write anyway.
	if token, _ := m.openBoardTools("", AgentEntry{Name: "c", Kind: AgentKindClaude}); token != "" {
		t.Error("a grant was minted for no board")
	}
}
