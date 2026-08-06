package acp

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// traceLines reads the trace file back as parsed records.
func traceLines(t *testing.T, path string) []map[string]any {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open trace: %v", err)
	}
	defer f.Close()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		var rec map[string]any
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			t.Fatalf("trace line is not JSON: %v (%s)", err, sc.Text())
		}
		out = append(out, rec)
	}
	return out
}

// seen lists what the trace actually holds, so a failure says what was there
// instead of only what was not.
func seen(recs []map[string]any) []string {
	var out []string
	for _, r := range recs {
		out = append(out, fmt.Sprintf("%v %v", r["dir"], r["kind"]))
	}
	return out
}

func hasTrace(recs []map[string]any, dir, kind string) bool {
	for _, r := range recs {
		if r["dir"] == dir && r["kind"] == kind {
			return true
		}
	}
	return false
}

func TestTracerIsOffByDefault(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultConfig(dir)
	if tr := newTracer(cfg, testLogger()); tr.Enabled() {
		t.Error("tracing must be opt-in")
	}
	if _, err := os.Stat(filepath.Join(dir, "acp-debug.jsonl")); !os.IsNotExist(err) {
		t.Error("no trace file should be created when tracing is off")
	}
}

// The point of the trace is to show a message that did not arrive, so a real
// session must record both directions of the protocol.
func TestTraceRecordsBothDirections(t *testing.T) {
	m, _, _, _, _ := testManagerWithEmitter(t, fakeClaudeMultiTurn, func(c *Config) {
		c.DebugLog = true
	})
	path := m.tr.Path()
	if path == "" {
		t.Fatal("tracing was requested but is off")
	}

	s := liveSession(t, m, "cardTrace")
	waitStatus(t, s, StatusDone)

	// Streamed text is flushed on a short timer, so the trace is polled rather
	// than read once — otherwise the test races the flush.
	for _, want := range []struct{ dir, kind string }{
		{TraceToCLI, "session/prompt"},   // what we sent the agent
		{TraceFromCLI, "session/update"}, // what it sent back
		{TraceToUI, EventSession},        // what the board was told
	} {
		w := want
		waitFor(t, 5*time.Second, "trace record "+w.dir+" "+w.kind, func() bool {
			return hasTrace(traceLines(t, path), w.dir, w.kind)
		})
	}

	recs := traceLines(t, path)

	// Every record must name its session, or a trace with two sessions in it
	// cannot be untangled.
	for _, r := range recs {
		if r["kind"] == "trace_started" {
			continue
		}
		if r["session"] == "" {
			t.Errorf("record without a session: %v", r)
			break
		}
	}
}

// A tool the policy does not cover is put to the person, and the trace has to
// show both halves of that: the agent asking, and the answer going back.
func TestTraceRecordsAPermissionQuestion(t *testing.T) {
	m, _, _, _, _ := testManagerWithEmitter(t, fakeClaudeAsksPermission, func(c *Config) {
		c.DebugLog = true
	})
	path := m.tr.Path()

	s := liveSession(t, m, "cardTraceQ")
	waitFor(t, 15*time.Second, "the agent to ask", func() bool { return len(m.Questions()) == 1 })
	if err := m.AnswerQuestion(m.Questions()[0].ID, Answer{Declined: true}); err != nil {
		t.Fatal(err)
	}
	waitStatus(t, s, StatusDone)

	recs := traceLines(t, path)
	if !hasTrace(recs, TraceFromCLI, "session/request_permission") {
		t.Error("the agent's request should be on the wire in the trace")
	}
}
