package sources

import (
	"context"
	"strings"
	"testing"
	"time"
)

// The agent kind is dialled by the manager rather than by the dialler, so what
// is worth pinning here is what it hands the agent: a tool that can only reach
// this source's own ingest route, the service's server, and a prompt carrying
// what the person configured.

type recordingRunner struct {
	runs []AgentRun
	err  error
}

func (r *recordingRunner) RunForSource(_ context.Context, run AgentRun) (string, error) {
	r.runs = append(r.runs, run)
	return "нашёл 2, сложил 2", r.err
}

func agentManifest() Manifest {
	return Manifest{
		Name:     "kaiten",
		Kind:     KindAgent,
		Command:  "bun",
		Args:     []string{"run", "server.ts"},
		Dir:      "/tmp/kaiten",
		TokenEnv: "KAITEN_TOKEN",
		Env:      map[string]string{"KAITEN_SITE": "https://example.kaiten.ru"},
		Agent: &AgentSpec{
			Agent: "clauuus",
			Task:  "карточки, назначенные на меня",
		},
	}
}

func agentEntry() SourceEntry {
	return SourceEntry{
		Name: "kaiten", Plugin: "kaiten", BoardID: "board1", Enabled: true,
		Config: map[string]string{"boardId": "77"},
	}
}

func agentTestManager(t *testing.T, runner AgentRunner) *Manager {
	t.Helper()
	m, _, _ := testManager(t, agentEntry())
	m.cfg.Plugins = []Manifest{agentManifest()}
	m.SetAgentRunner(runner)
	m.SetIngestURL("http://127.0.0.1:9000/")
	return m
}

// The agent gets two servers and no other way to write anything: ours, pointed
// at this source's own ingest route with a token minted for the turn, and the
// service's own, started exactly as the mapping kind would start it.
func TestAnAgentSourceIsHandedItsOwnInboxAndNothingElse(t *testing.T) {
	runner := &recordingRunner{}
	m := agentTestManager(t, runner)

	conn, err := m.newAgentConn(agentEntry(), agentManifest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Poll(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	if len(runner.runs) != 1 {
		t.Fatalf("runs: %d", len(runner.runs))
	}
	run := runner.runs[0]
	if run.Agent != "clauuus" {
		t.Fatalf("agent: %q", run.Agent)
	}

	var ours, service *AgentServer
	for i := range run.Servers {
		switch run.Servers[i].Name {
		case InboxServerName:
			ours = &run.Servers[i]
		case "kaiten":
			service = &run.Servers[i]
		}
	}
	if ours == nil || service == nil {
		t.Fatalf("servers: %+v", run.Servers)
	}
	if ours.Env[EnvInboxURL] != "http://127.0.0.1:9000" || ours.Env[EnvInboxSource] != "kaiten" {
		t.Fatalf("inbox env: %+v", ours.Env)
	}
	// A token minted for this turn, and it is a real one: the entry now
	// authorizes exactly it.
	entry, _ := m.Source("kaiten")
	if !entry.CheckToken(ours.Env[EnvInboxToken]) {
		t.Fatal("the token handed over must be the one the source accepts")
	}
	if service.Command != "bun" || service.Env["KAITEN_SITE"] != "https://example.kaiten.ru" {
		t.Fatalf("service server: %+v", service)
	}
}

// What the person typed into the source dialog has to reach the agent, and so
// do the two instructions it gets wrong on its own: file everything, and never
// invent an id.
func TestTheAgentIsToldWhatToLookForAndWhatNotToInvent(t *testing.T) {
	runner := &recordingRunner{}
	m := agentTestManager(t, runner)

	conn, err := m.newAgentConn(agentEntry(), agentManifest())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Poll(context.Background(), ""); err != nil {
		t.Fatal(err)
	}

	prompt := runner.runs[0].Prompt
	for _, want := range []string{
		"карточки, назначенные на меня", // what the person asked for
		"boardId: 77",      // what they configured
		"file_item",        // the only way to file anything
		"Never invent one", // an invented id is a card per poll
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("the prompt is missing %q:\n%s", want, prompt)
		}
	}
}

// A machine with the agent integration switched off still has sources — that is
// the whole reason this package does not import internal/acp — so an agent
// source has to say what is wrong rather than fail halfway through a turn.
func TestAnAgentSourceWithoutAgentsSaysSo(t *testing.T) {
	m, _, _ := testManager(t, agentEntry())
	m.cfg.Plugins = []Manifest{agentManifest()}
	m.SetIngestURL("http://127.0.0.1:9000")

	if _, err := m.newAgentConn(agentEntry(), agentManifest()); err == nil {
		t.Fatal("a source read by an agent needs the agent integration")
	}

	// And with agents but nowhere to file to, which is the same failure from
	// the other side.
	m.SetAgentRunner(&recordingRunner{})
	m.SetIngestURL("")
	if _, err := m.newAgentConn(agentEntry(), agentManifest()); err == nil {
		t.Fatal("there has to be somewhere to file what is found")
	}
}

// A turn is a conversation with a model and somebody's API. Two minutes is what
// a plugin gets; this one says so for itself, or every poll would be cancelled
// halfway.
func TestAnAgentTurnIsGivenLongerThanAPluginPoll(t *testing.T) {
	m := agentTestManager(t, &recordingRunner{})
	conn, err := m.newAgentConn(agentEntry(), agentManifest())
	if err != nil {
		t.Fatal(err)
	}
	if got := pollTimeoutOf(conn); got <= pollTimeout {
		t.Fatalf("timeout: %v", got)
	}
}

// An agent's poll is a conversation with a model and costs money every time, so
// a source nobody gave a schedule is asked far less often than a plugin would
// be — and a schedule somebody did set is still theirs.
func TestAnAgentSourceIsAskedRarelyUnlessToldOtherwise(t *testing.T) {
	manifest := agentManifest()
	if got := intervalFor(agentEntry(), manifest); got != agentInterval {
		t.Fatalf("default: %v", got)
	}

	entry := agentEntry()
	entry.IntervalSeconds = 120
	if got := intervalFor(entry, manifest); got != 2*time.Minute {
		t.Fatalf("what the person set: %v", got)
	}

	// A plugin keeps the schedule it always had.
	if got := intervalFor(agentEntry(), Manifest{Name: "телефон"}); got != defaultInterval {
		t.Fatalf("plugin default: %v", got)
	}
}
