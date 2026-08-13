package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/updater"
	"github.com/wailsapp/wails/v3/pkg/updater/providers/endpoint"
)

// How this app updates itself.
//
// The machinery is the framework's: `app.Updater` is on every Wails v3
// application without registering anything, and it owns the whole of the risky
// part — streaming the artifact, checking its signature, unpacking it, and the
// helper process that waits for us to exit and renames the new bundle into
// place. Nothing here reimplements any of that. What this file adds is the
// three things the framework deliberately leaves to the application: which
// release feed to trust, what to remember between launches, and what a person
// sees.
//
// **The feed is a signed manifest, not the GitHub API.** The framework's
// `github` provider reads a release's assets and can verify a SHA256SUMS
// sidecar, which catches a corrupted download and nothing else: the hash and
// the file come from the same place, so a release that was tampered with
// carries a hash that agrees with it. The `endpoint` provider reads a
// manifest.json whose artifacts are signed, and the signature is checked
// against updaterPublicKey below — compiled into this binary, so the feed has
// no say in which key authenticates it. The manifest is published as a file of
// the release itself, so the hosting is still GitHub Releases and the whole
// publishing side is one `wails3 updater manifest` in CI.
//
// **The framework's own window is not used** (updater.WindowNone). It is a
// good window and it is entirely in English, hard-coded; this product is
// Russian. So Go subscribes to the framework's events and re-emits one event
// of ours carrying the whole state, through emitter.go — which means the front
// door's socket, which is the only path that reaches a page opened on a phone
// through the tailnet door as well as the desktop window.

//go:embed build/updater.key.pub
var updaterPublicKey []byte

// updateManifestURL is where the manifest of the newest release lives. GitHub
// serves `releases/latest/download/<asset>` as a redirect to the newest
// non-prerelease, which is what makes this one fixed address rather than
// something that has to know the version it is looking for. A repository with
// no releases answers 404, which the provider reads as "nothing newer".
//
// The artifact URLs inside the manifest are absolute (CI passes -url-prefix
// with the tag), so nothing here depends on what that redirect resolves to.
const updateManifestURL = "https://github.com/artipop/xciii/releases/latest/download/manifest.json"

// updateCheckInterval is our own timer rather than updater.Config.CheckInterval.
// Init may be called once and StopPeriodicCheck cannot be undone, so the
// framework's timer would make «проверять автоматически» a switch that takes
// effect at the next launch. This one is read on every tick.
const updateCheckInterval = 6 * time.Hour

// updateFirstCheckDelay keeps the first check off the launch path: starting up
// is when this app opens a database, restores a PATH from the login shell and
// starts plugin processes, and none of that should wait behind an HTTP request
// to another continent.
const updateFirstCheckDelay = time.Minute

// updateSettings is <dataDir>/updates.json — the part of updating that has to
// survive a restart. The framework keeps none of it: the download is a temp
// directory the helper deletes, and the version a person skipped lives in a
// field of the running Updater and dies with the process.
type updateSettings struct {
	// Enabled is a pointer so that a file written before this field existed
	// reads as "not answered" rather than as "the user turned it off".
	Enabled *bool `json:"enabled,omitempty"`
	// SkippedVersion is the release a person said no to. Restored into the
	// Updater at startup, or «Пропустить эту версию» would mean "until you
	// quit".
	SkippedVersion string `json:"skippedVersion,omitempty"`
	// LastCheckedAt is RFC 3339, and exists so the panel can answer "has this
	// thing ever looked" without a check of its own.
	LastCheckedAt string `json:"lastCheckedAt,omitempty"`
}

func (s updateSettings) enabled() bool { return s.Enabled == nil || *s.Enabled }

func updateSettingsPath() (string, error) {
	dir, err := appDataDir("", 0o755)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "updates.json"), nil
}

// readUpdateSettings never fails: a missing file is the defaults, and a file
// somebody has broken is the defaults plus a line in the log. Refusing to
// start because a preferences file is malformed would be a worse answer than
// checking for updates one more time than asked.
func readUpdateSettings(path string) updateSettings {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return updateSettings{}
	}
	if err != nil {
		log.Printf("updates: %s: %v", path, err)
		return updateSettings{}
	}
	var s updateSettings
	if err := json.Unmarshal(data, &s); err != nil {
		log.Printf("updates: %s: %v", path, err)
		return updateSettings{}
	}
	return s
}

// writeUpdateSettings writes the whole file, indented, like every other
// settings file this app keeps: it is small, it is occasionally read by a
// person, and there is one writer.
func writeUpdateSettings(path string, s updateSettings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

// updateState is what the settings panel draws and what the acp:update event
// carries — the same value, so the panel needs no separate story for "what I
// asked for" and "what happened while I was looking".
type updateState struct {
	// Supported is false where there is nothing to update: the headless server
	// build, and any deployment where the page has no Go side at all.
	Supported bool `json:"supported"`
	Enabled   bool `json:"enabled"`

	CurrentVersion string `json:"currentVersion"`

	// Status is the framework's own updater.State, read fresh rather than
	// inferred from which event arrived: the event bus dispatches each event
	// in a goroutine of its own, so two of them can be seen out of order, and
	// a status that went backwards would be a progress bar that did.
	Status string `json:"status"`

	AvailableVersion string `json:"availableVersion,omitempty"`
	ReleaseName      string `json:"releaseName,omitempty"`
	Notes            string `json:"notes,omitempty"`
	SizeBytes        int64  `json:"sizeBytes,omitempty"`
	Downloaded       int64  `json:"downloaded,omitempty"`

	SkippedVersion string `json:"skippedVersion,omitempty"`
	LastCheckedAt  string `json:"lastCheckedAt,omitempty"`
	Error          string `json:"error,omitempty"`

	// Path is where the settings live, so the panel can name the file when
	// something has to be looked at by hand.
	Path string `json:"path,omitempty"`
}

// updateEvent is the one event the page listens on. One event carrying the
// whole state rather than eleven mirroring the framework's: the page has a
// single subscription and no way to see a partial picture.
const updateEvent = "acp:update"

// updateController owns the Updater, the settings file and the snapshot the UI
// reads. It exists for the same reason tailnetController does — the pieces
// arrive at different times and the switch keeps working long afterwards.
type updateController struct {
	up      *updater.Updater
	emitter *wailsEmitter
	path    string

	mu       sync.Mutex
	settings updateSettings
	state    updateState

	stop     chan struct{}
	stopOnce sync.Once
}

// newUpdateController configures the framework's Updater and restores what the
// last run remembered. It returns nil (and logs) rather than failing the
// launch: an app that will not start because a release feed is misconfigured
// is worse than an app that cannot update itself.
func newUpdateController(wapp *application.App, emitter *wailsEmitter) *updateController {
	path, err := updateSettingsPath()
	if err != nil {
		log.Printf("updates: disabled, no data dir: %v", err)
		return nil
	}
	settings := readUpdateSettings(path)

	feed, err := endpoint.New(endpoint.Config{URL: updateManifestURL, Channel: "stable"})
	if err != nil {
		log.Printf("updates: disabled, feed error: %v", err)
		return nil
	}
	if err := wapp.Updater.Init(updater.Config{
		CurrentVersion: appVersion,
		Providers:      []updater.Provider{feed},
		PublicKey:      updaterPublicKey,
		// The flow is drawn by settings/updatesPanel.tsx, in Russian, off the
		// event below.
		Window: updater.WindowNone,
	}); err != nil {
		log.Printf("updates: disabled, init error: %v", err)
		return nil
	}
	if settings.SkippedVersion != "" {
		wapp.Updater.SkipVersion(settings.SkippedVersion)
	}

	c := &updateController{
		up:      wapp.Updater,
		emitter: emitter,
		path:    path,
		stop:    make(chan struct{}),
	}
	c.settings = settings
	c.state = updateState{
		Supported:      true,
		Enabled:        settings.enabled(),
		CurrentVersion: appVersion,
		Status:         string(wapp.Updater.State()),
		SkippedVersion: settings.SkippedVersion,
		LastCheckedAt:  settings.LastCheckedAt,
		Path:           path,
	}
	c.listen(wapp)
	go c.poll()
	log.Printf("updates: %s, feed %s", appVersion, updateManifestURL)
	return c
}

// listen turns the framework's eleven events into one of ours. Everything the
// snapshot cannot read back off the Updater — the release that was found, how
// many bytes have arrived, what went wrong — is recorded here as it passes.
func (c *updateController) listen(wapp *application.App) {
	release := func(e *application.CustomEvent) {
		rel, ok := e.Data.(*updater.Release)
		if !ok || rel == nil {
			c.publish(nil)
			return
		}
		c.publish(func(s *updateState) {
			s.AvailableVersion = rel.Version
			s.ReleaseName = rel.Name
			s.Notes = rel.Notes
			s.SizeBytes = rel.Artifact.Size
			s.Error = ""
		})
	}

	wapp.Event.On(updater.EventCheckStarted, func(*application.CustomEvent) {
		c.publish(func(s *updateState) { s.Error = "" })
	})
	wapp.Event.On(updater.EventUpdateAvailable, func(e *application.CustomEvent) {
		c.checked()
		release(e)
	})
	wapp.Event.On(updater.EventNoUpdate, func(*application.CustomEvent) {
		c.checked()
		c.publish(func(s *updateState) {
			// Nothing to offer, so nothing left over from a previous find:
			// a version pill for a release that is no longer on offer is a
			// button that does nothing.
			s.AvailableVersion = ""
			s.ReleaseName = ""
			s.Notes = ""
			s.SizeBytes = 0
			s.Downloaded = 0
			s.Error = ""
		})
	})
	wapp.Event.On(updater.EventDownloadStarted, release)
	wapp.Event.On(updater.EventDownloadProgress, func(e *application.CustomEvent) {
		p, ok := e.Data.(updater.Progress)
		if !ok {
			return
		}
		c.publish(func(s *updateState) {
			s.Downloaded = p.Written
			if p.Total > 0 {
				s.SizeBytes = p.Total
			}
		})
	})
	wapp.Event.On(updater.EventDownloadComplete, release)
	wapp.Event.On(updater.EventVerifying, release)
	wapp.Event.On(updater.EventInstalling, release)
	wapp.Event.On(updater.EventUpdateReady, release)
	wapp.Event.On(updater.EventError, func(e *application.CustomEvent) {
		info, ok := e.Data.(updater.ErrorInfo)
		if !ok {
			c.publish(nil)
			return
		}
		log.Printf("updates: %s: %s", info.Stage, info.Message)
		c.publish(func(s *updateState) { s.Error = info.Message })
	})
}

// poll is the automatic half. It only ever checks: finding a release is worth
// telling somebody about, but spending a hundred megabytes of somebody's
// connection without being asked is not, so the download waits for the button.
func (c *updateController) poll() {
	timer := time.NewTimer(updateFirstCheckDelay)
	defer timer.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-timer.C:
		}
		timer.Reset(updateCheckInterval)

		c.mu.Lock()
		enabled := c.settings.enabled()
		c.mu.Unlock()
		if !enabled {
			continue
		}
		if _, err := c.up.Check(context.Background()); err != nil {
			// Already recorded by the error event and shown in the panel; the
			// timer is not the place to make it louder.
			continue
		}
	}
}

func (c *updateController) close() {
	if c == nil {
		return
	}
	c.stopOnce.Do(func() { close(c.stop) })
}

// publish applies one change to the snapshot, re-reads the status off the
// Updater and tells the page. Every path into the snapshot goes through here,
// which is what keeps "what the panel shows" and "what the event carried" the
// same value.
func (c *updateController) publish(change func(*updateState)) {
	if c == nil {
		return
	}
	c.mu.Lock()
	if change != nil {
		change(&c.state)
	}
	c.state.Status = string(c.up.State())
	c.state.Enabled = c.settings.enabled()
	c.state.SkippedVersion = c.settings.SkippedVersion
	c.state.LastCheckedAt = c.settings.LastCheckedAt
	snapshot := c.state
	c.mu.Unlock()

	if c.emitter != nil {
		c.emitter.Emit(updateEvent, snapshot)
	}
}

// checked records that the feed answered, whatever it answered. It is the one
// thing worth writing to disk on every check: it is how the panel says when it
// last looked without looking again.
func (c *updateController) checked() {
	c.mu.Lock()
	c.settings.LastCheckedAt = time.Now().UTC().Format(time.RFC3339)
	settings := c.settings
	path := c.path
	c.mu.Unlock()
	if err := writeUpdateSettings(path, settings); err != nil {
		log.Printf("updates: %v", err)
	}
}

// snapshot is what GetUpdateState answers with.
func (c *updateController) snapshot() updateState {
	if c == nil {
		return updateState{Supported: false, CurrentVersion: appVersion, Status: string(updater.StateUnconfigured)}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state.Status = string(c.up.State())
	return c.state
}

// setEnabled turns the automatic check on or off. It takes effect on the next
// tick rather than at the next launch, which is the whole reason the timer is
// ours.
func (c *updateController) setEnabled(enabled bool) (updateState, error) {
	if c == nil {
		return updateState{}, errUpdatesUnavailable
	}
	c.mu.Lock()
	c.settings.Enabled = &enabled
	settings := c.settings
	path := c.path
	c.mu.Unlock()
	if err := writeUpdateSettings(path, settings); err != nil {
		return c.snapshot(), err
	}
	c.publish(nil)
	return c.snapshot(), nil
}

// skip records the release now on offer as one to stop mentioning. Both halves
// matter: the Updater treats it as up to date from here on, and the file is
// what makes that survive a restart.
func (c *updateController) skip() error {
	if c == nil {
		return errUpdatesUnavailable
	}
	c.mu.Lock()
	version := c.state.AvailableVersion
	c.mu.Unlock()
	if version == "" {
		return errors.New("нечего пропускать: обновление не найдено")
	}

	c.up.SkipVersion(version)

	c.mu.Lock()
	c.settings.SkippedVersion = version
	settings := c.settings
	path := c.path
	c.mu.Unlock()
	if err := writeUpdateSettings(path, settings); err != nil {
		return err
	}
	c.publish(func(s *updateState) {
		s.AvailableVersion = ""
		s.ReleaseName = ""
		s.Notes = ""
		s.SizeBytes = 0
		s.Downloaded = 0
	})
	return nil
}

var errUpdatesUnavailable = errors.New("обновление этой сборки не поддерживается")

// check asks the feed. It returns as soon as the request is under way: the
// answer arrives as the event, so the panel draws «проверяем» from the same
// state machine that draws everything else rather than from a promise.
func (c *updateController) check() error {
	if c == nil {
		return errUpdatesUnavailable
	}
	go func() {
		if _, err := c.up.Check(context.Background()); err != nil {
			c.failed(err)
		}
	}()
	return nil
}

// install downloads, verifies and stages what the last check found. Same
// bargain as check: the progress is the event.
func (c *updateController) install() error {
	if c == nil {
		return errUpdatesUnavailable
	}
	go func() {
		if err := c.up.DownloadAndInstall(context.Background()); err != nil {
			c.failed(err)
		}
	}()
	return nil
}

// failed puts an error the caller cannot see onto the panel. Most failures
// arrive as the framework's own error event and land in the snapshot that way;
// the ones that do not are those refused before any stage began — nothing to
// download, a download already running — and without this they would be a line
// in a log nobody has open and a button that appeared to do nothing.
func (c *updateController) failed(err error) {
	log.Printf("updates: %v", err)
	c.publish(func(s *updateState) { s.Error = err.Error() })
}

// restart hands over to the framework's helper: it spawns a copy of this
// binary in helper mode, we quit, it waits for us to be gone, swaps the bundle
// and launches the new one. The helper is why main() calls
// updater.HandleHelperMode before anything else.
func (c *updateController) restart() error {
	if c == nil {
		return errUpdatesUnavailable
	}
	if err := c.up.Restart(context.Background()); err != nil {
		return fmt.Errorf("не удалось перезапустить: %w", err)
	}
	return nil
}
