package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/artipop/xciii/internal/sources/plugin"
)

// Running a plugin: one goroutine per source, started when the app starts and
// stopped with it. Polling is on a schedule because a laptop behind NAT has
// nowhere for a webhook to land — the same reason the repository watcher polls
// — and a plugin that would rather push says so in its capabilities and is left
// to talk when it has something.

// Default and bounds for the schedule. A source that has just failed is not
// worth asking again immediately, and one that keeps failing is not worth
// asking often.
const (
	defaultInterval = 5 * time.Minute
	maxBackoff      = 30 * time.Minute
	pollTimeout     = 2 * time.Minute
)

// minInterval is the floor under a source's schedule: a plugin that answers
// instantly would otherwise be asked in a tight loop. A variable rather than a
// constant so a test can watch several polls without waiting half a minute for
// each — nothing else lowers it.
var minInterval = 30 * time.Second

// State is what a source is doing, for the strip of text that makes a silent
// integration debuggable.
type State string

const (
	StateOff         State = "off"
	StateStarting    State = "starting"
	StateRunning     State = "running"
	StateNeedsReauth State = "needs-reauth"
	StateError       State = "error"
)

// Status is one source's state, as the UI shows it.
type Status struct {
	Source   string     `json:"source"`
	State    State      `json:"state"`
	LastPoll *time.Time `json:"lastPoll,omitempty"`
	LastItem *time.Time `json:"lastItem,omitempty"`
	Error    string     `json:"error,omitempty"`
}

// conn is the half of plugin.Client the runner uses. It is an interface so a
// test can drive the runner without a subprocess; that the real one works over
// a real process is settled in internal/sources/plugin.
type conn interface {
	Capabilities() plugin.Capabilities
	Poll(ctx context.Context, cursor string) (plugin.PollResult, error)
	Close()
}

// dialer opens a connection to the plugin a source names.
type dialer func(ctx context.Context, entry SourceEntry, manifest Manifest, cred plugin.Credentials, handler plugin.Handler) (conn, error)

// SetDialer replaces how plugins are started (tests inject a fake).
func (m *Manager) SetDialer(d dialer) { m.dial = d }

// credentialsFor is the access token a plugin is started with, renewed first if
// it has expired. A missing one is not an error here: whether a source can work
// without a credential is the plugin's answer, not this side's guess.
func (m *Manager) credentialsFor(ctx context.Context, entry SourceEntry) plugin.Credentials {
	token, ok := m.refreshedToken(ctx, entry)
	if !ok {
		return plugin.Credentials{}
	}
	cred := plugin.Credentials{AccessToken: token.Access}
	if !token.Expires.IsZero() {
		cred.ExpiresAt = token.Expires.Format(time.RFC3339)
	}
	return cred
}

// dialPlugin is the real one: spawn the manifest's command and hand it the
// source it is being started for.
//
// Which protocol the process speaks is the manifest's business and nobody
// else's: past this function the runner, the pipeline and the log cannot tell
// an MCP server from a plugin written against sources/protocol, which is what
// makes a new MCP source a JSON entry rather than a program.
func dialPlugin(ctx context.Context, entry SourceEntry, manifest Manifest, cred plugin.Credentials, handler plugin.Handler) (conn, error) {
	if manifest.IsMCP() {
		return dialMCP(ctx, entry, manifest, cred, handler)
	}

	env, err := manifest.RenderEnv(entry)
	if err != nil {
		return nil, err
	}
	return plugin.Dial(ctx, plugin.Spec{
		Command:     manifest.Argv(),
		Dir:         manifest.Dir,
		Env:         envList(env),
		Source:      plugin.SourceInfo{Name: entry.Name, Config: entry.Config},
		Credentials: cred,
		Host:        plugin.HostInfo{Name: "XCIII"},
	}, handler)
}

// Start brings up every enabled source that names a plugin. It is safe to call
// once; Stop is what ends it.
func (m *Manager) Start(ctx context.Context) {
	m.mu.Lock()
	if m.rootCtx != nil {
		m.mu.Unlock()
		return
	}
	m.rootCtx, m.stop = context.WithCancel(ctx)
	if m.dial == nil {
		m.dial = dialPlugin
	}
	entries := append([]SourceEntry(nil), m.cfg.Sources...)
	m.mu.Unlock()

	for _, entry := range entries {
		if entry.Enabled && strings.TrimSpace(entry.Plugin) != "" {
			m.run(entry)
		}
	}
}

// Stop ends every plugin and waits for them, bounded by the caller's patience.
func (m *Manager) Stop(grace time.Duration) {
	m.mu.Lock()
	stop := m.stop
	m.mu.Unlock()
	if stop == nil {
		return
	}
	stop()

	done := make(chan struct{})
	go func() {
		m.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(grace):
	}
}

// run starts one source's loop.
func (m *Manager) run(entry SourceEntry) {
	m.setStatus(entry.Name, func(s *Status) { s.State = StateStarting })

	// One cancel per source, so a source that has just been added, edited or
	// given a token can be started — and an older loop for the same name
	// stopped — without restarting the app. Adding a source and being told to
	// come back after a restart is not a feature that works.
	m.mu.Lock()
	root := m.rootCtx
	if root == nil {
		// Nothing is running yet: Start will bring this one up with the rest.
		m.mu.Unlock()
		return
	}
	if stop, ok := m.running[entry.Name]; ok {
		stop()
	}
	ctx, stop := context.WithCancel(root)
	if m.running == nil {
		m.running = map[string]context.CancelFunc{}
	}
	m.running[entry.Name] = stop
	m.mu.Unlock()

	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		defer stop()
		m.loop(ctx, entry)
	}()
}

// Restart brings one source up again under whatever the registry now says: a
// source that was just added, an entry that was edited, a token that has only
// now been pasted. A source that is disabled is stopped instead.
func (m *Manager) Restart(name string) {
	entry, ok := m.Source(name)
	if !ok {
		m.stopSource(name)
		return
	}
	if !entry.Enabled || strings.TrimSpace(entry.Plugin) == "" {
		// Not a running kind of source: an ingest source is fed from outside
		// and has no process at all.
		m.stopSource(name)
		return
	}
	m.run(entry)
}

func (m *Manager) stopSource(name string) {
	m.mu.Lock()
	stop, ok := m.running[name]
	delete(m.running, name)
	m.mu.Unlock()
	if ok {
		stop()
	}
}

func (m *Manager) loop(ctx context.Context, entry SourceEntry) {
	manifest, ok := m.Plugin(entry.Plugin)
	if !ok {
		m.fail(entry.Name, fmt.Errorf("плагин %q не зарегистрирован", entry.Plugin))
		return
	}

	handler := &pluginHandler{mgr: m, source: entry.Name}
	// The agent kind is dialled by the manager itself rather than by the
	// dialler: what it needs — the agent runner, the ingest address, a token —
	// belongs to the app and not to the manifest. Everything after this line
	// treats it as any other plugin.
	dial := m.dial
	if manifest.IsAgent() {
		dial = func(context.Context, SourceEntry, Manifest, plugin.Credentials, plugin.Handler) (conn, error) {
			return m.newAgentConn(entry, manifest)
		}
	}
	client, err := dial(ctx, entry, manifest, m.credentialsFor(ctx, entry), handler)
	if err != nil {
		m.fail(entry.Name, err)
		return
	}
	defer client.Close()

	caps := client.Capabilities()
	m.setStatus(entry.Name, func(s *Status) {
		s.State = StateRunning
		s.Error = ""
	})

	// A plugin that only pushes has nothing to be asked for: it talks when it
	// has something, and the loop is here only to keep the process alive until
	// the app stops.
	if !caps.Poll {
		<-ctx.Done()
		return
	}

	// The first poll is immediate: a source that has just been switched on has
	// been waiting for whoever switched it on, not for the schedule.
	wait := time.Duration(0)
	for {
		if wait > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
		} else if ctx.Err() != nil {
			return
		}

		pollCtx, cancel := context.WithTimeout(ctx, pollTimeout)
		result, err := client.Poll(pollCtx, handler.Cursor())
		cancel()
		if err != nil {
			next, stop := m.afterPollError(entry, err, wait)
			if stop {
				return
			}
			wait = next
			continue
		}

		if caps.Cursor {
			handler.SetCursor(result.Cursor)
		}
		// Recorded before the items are dealt with: the poll succeeded when the
		// plugin answered, and what became of what it sent is the pipeline's
		// business and the log's.
		m.setStatus(entry.Name, func(s *Status) {
			now := time.Now()
			s.LastPoll = &now
			s.State = StateRunning
			s.Error = ""
		})
		m.deliverRaw(ctx, entry.Name, result.Items)

		wait = entry.interval()
		if result.RetryAfterSeconds > 0 {
			// The service said when to come back; that beats our schedule.
			wait = time.Duration(result.RetryAfterSeconds) * time.Second
		}
	}
}

// pollTimeoutOf is how long one poll may take. A plugin answers a question and
// two minutes is generous; an agent holds a conversation with a model and says
// so for itself.
func pollTimeoutOf(c conn) time.Duration {
	if slow, ok := c.(interface{ PollTimeout() time.Duration }); ok {
		if d := slow.PollTimeout(); d > 0 {
			return d
		}
	}
	return pollTimeout
}

// afterPollError decides what a failed poll costs: how long to wait, and
// whether to give up on this source until the app is restarted.
func (m *Manager) afterPollError(entry SourceEntry, err error, wait time.Duration) (time.Duration, bool) {
	var pluginErr *plugin.Error
	if e, ok := err.(*plugin.Error); ok {
		pluginErr = e
	}
	switch {
	case pluginErr != nil && pluginErr.NeedsReauth():
		// Asking again with a dead credential is noise the service can see, so
		// the source stops until a person deals with it.
		m.setStatus(entry.Name, func(s *Status) {
			s.State = StateNeedsReauth
			s.Error = pluginErr.Error()
		})
		m.record(EventRecord{Source: entry.Name, Outcome: OutcomeFailed, Detail: pluginErr.Error()})
		return 0, true
	case pluginErr != nil && !pluginErr.Retryable():
		// A bad field cannot fix itself either, but the plugin is still alive,
		// so the loop waits rather than exits: the config may be corrected.
		m.setStatus(entry.Name, func(s *Status) {
			s.State = StateError
			s.Error = pluginErr.Error()
		})
		m.record(EventRecord{Source: entry.Name, Outcome: OutcomeFailed, Detail: pluginErr.Error()})
		return maxBackoff, false
	}

	m.log.Warn("sources: опрос не удался", "source", entry.Name, "err", err)
	m.setStatus(entry.Name, func(s *Status) {
		s.State = StateError
		s.Error = err.Error()
	})
	// The backoff doubles the schedule, not the wait that produced the error:
	// the first poll of a source happens immediately, and doubling nothing is
	// still nothing.
	next := wait * 2
	if next < entry.interval() {
		next = entry.interval()
	}
	if next > maxBackoff {
		next = maxBackoff
	}
	return next, false
}

// deliverRaw turns what a plugin sent into items and runs them through the
// pipeline. A payload that does not parse costs itself: one bad item must not
// discard the batch it arrived in.
func (m *Manager) deliverRaw(ctx context.Context, source string, raw []json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	items := make([]Item, 0, len(raw))
	for _, payload := range raw {
		var item Item
		if err := json.Unmarshal(payload, &item); err != nil {
			m.record(EventRecord{Source: source, Outcome: OutcomeFailed,
				Detail: "плагин прислал запись, которую не удалось разобрать: " + err.Error()})
			continue
		}
		item.Raw = payload
		items = append(items, item.WithFallbackID())
	}
	if len(items) == 0 {
		return
	}
	if _, err := m.Deliver(ctx, source, items); err != nil {
		m.log.Warn("sources: не удалось разложить принесённое", "source", source, "err", err)
	}
	m.setStatus(source, func(s *Status) {
		now := time.Now()
		s.LastItem = &now
	})
}

// pluginHandler is what a plugin says without being asked. It also holds the
// cursor, because a plugin that both polls and pushes moves it from two
// goroutines and a variable shared between them would be a race — one that
// would show up as a source quietly re-reading or skipping a stretch of its own
// history, which is exactly the kind of bug nobody would trace back to here.
type pluginHandler struct {
	mgr    *Manager
	source string

	mu     sync.Mutex
	cursor string
}

func (h *pluginHandler) Cursor() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.cursor
}

func (h *pluginHandler) SetCursor(cursor string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.cursor = cursor
}

func (h *pluginHandler) Items(items []json.RawMessage, cursor string) {
	if cursor != "" {
		h.SetCursor(cursor)
	}
	h.mgr.deliverRaw(h.mgr.rootContext(), h.source, items)
}

func (h *pluginHandler) Log(level, message string) {
	// A plugin's log lives with the source's own events, because that is where
	// somebody looks when nothing happened.
	h.mgr.record(EventRecord{Source: h.source, Outcome: OutcomeFailed, Detail: level + ": " + message})
}

func (h *pluginHandler) NeedsReauth(reason string) {
	h.mgr.setStatus(h.source, func(s *Status) {
		s.State = StateNeedsReauth
		s.Error = reason
	})
}

func (m *Manager) fail(source string, err error) {
	m.log.Warn("sources: источник не поднялся", "source", source, "err", err)
	m.setStatus(source, func(s *Status) {
		s.State = StateError
		s.Error = err.Error()
	})
	m.record(EventRecord{Source: source, Outcome: OutcomeFailed, Detail: err.Error()})
}

func (m *Manager) rootContext() context.Context {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rootCtx == nil {
		return context.Background()
	}
	return m.rootCtx
}

func (m *Manager) setStatus(source string, apply func(*Status)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.status == nil {
		m.status = map[string]*Status{}
	}
	current, ok := m.status[source]
	if !ok {
		current = &Status{Source: source, State: StateOff}
		m.status[source] = current
	}
	apply(current)
}

// Status is what a source is doing now.
func (m *Manager) Status(source string) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	if current, ok := m.status[source]; ok {
		return *current
	}
	return Status{Source: source, State: StateOff}
}

// intervalFor is how often this source is asked. A source read by an agent is
// asked far less often when nobody said otherwise: a plugin's poll is an HTTP
// request, and an agent's is a conversation with a model that costs money every
// time. What the person set always wins — this is only the default.
func intervalFor(entry SourceEntry, manifest Manifest) time.Duration {
	if entry.IntervalSeconds <= 0 && manifest.IsAgent() {
		return agentInterval
	}
	return entry.interval()
}

// agentInterval is the default schedule of an agent source. Half an hour rather
// than five minutes: what arrives from a tracker is not urgent, and the
// difference is a session six times a day instead of a session every five
// minutes.
const agentInterval = 30 * time.Minute

// interval is how often this source is asked, never faster than the floor: a
// plugin that answers instantly would otherwise be asked in a tight loop.
func (s SourceEntry) interval() time.Duration {
	if s.IntervalSeconds <= 0 {
		return defaultInterval
	}
	d := time.Duration(s.IntervalSeconds) * time.Second
	if d < minInterval {
		return minInterval
	}
	return d
}

// Statuses is every source's state at once, which is what a dialog listing
// them needs: one call rather than one per row.
func (m *Manager) Statuses() []Status {
	m.mu.RLock()
	entries := append([]SourceEntry(nil), m.cfg.Sources...)
	m.mu.RUnlock()

	out := make([]Status, 0, len(entries))
	for _, entry := range entries {
		out = append(out, m.Status(entry.Name))
	}
	return out
}

// Plugin returns a manifest by name. What a person typed into the registry
// wins over a file dropped in the manifests directory: it is more likely to be
// what they meant.
func (m *Manager) Plugin(name string) (Manifest, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, list := range [][]Manifest{m.cfg.Plugins, m.catalog} {
		for _, p := range list {
			if strings.EqualFold(p.Name, name) {
				return p, true
			}
		}
	}
	return Manifest{}, false
}

// Plugins returns every manifest there is, the registry's and the catalogue's,
// which is what the dialog offers when a source is being made.
func (m *Manager) Plugins() []Manifest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := append([]Manifest(nil), m.cfg.Plugins...)
	for _, p := range m.catalog {
		if !hasManifest(out, p.Name) {
			out = append(out, p)
		}
	}
	return out
}

func hasManifest(list []Manifest, name string) bool {
	for _, p := range list {
		if strings.EqualFold(p.Name, name) {
			return true
		}
	}
	return false
}

// AddPlugin registers a manifest.
func (m *Manager) AddPlugin(manifest Manifest) (Manifest, error) {
	valid, err := manifest.Validate()
	if err != nil {
		return Manifest{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.cfg.Plugins {
		if strings.EqualFold(p.Name, valid.Name) {
			m.cfg.Plugins[i] = valid
			return valid, m.persistLocked()
		}
	}
	m.cfg.Plugins = append(m.cfg.Plugins, valid)
	return valid, m.persistLocked()
}

// RemovePlugin forgets a manifest. Sources naming it stop working, and say so
// when they are next started, rather than being deleted along with it: what a
// source has already brought is worth more than tidiness.
func (m *Manager) RemovePlugin(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, p := range m.cfg.Plugins {
		if strings.EqualFold(p.Name, name) {
			m.cfg.Plugins = append(m.cfg.Plugins[:i], m.cfg.Plugins[i+1:]...)
			return m.persistLocked()
		}
	}
	return fmt.Errorf("плагин %q не найден", name)
}
