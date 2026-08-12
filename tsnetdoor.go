package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
)

// The tailnet door is the same front door, published a second time — as a node
// of the user's own tailnet, so a phone can open the board from anywhere.
//
// It is a tsnet node rather than a port on some interface. A port would be
// reachable by anything that can route to this machine, and nothing here
// authenticates a person: the bootstrap script hands the board's session token
// to whoever asks for a page, and /acp/terminal/{id}/ws is a shell in the
// user's project. A tsnet listener is reachable only from the tailnet, needs no
// daemon and no root — and, unlike a port, it knows who is calling.
//
// That is the second half: WhoIs gives the tailnet identity of the peer, so the
// gate below is an ACL over identities the user already manages, not a pairing
// code of ours. The loopback door keeps no gate at all — the only thing that
// reaches it is this application's own window.

// tailnetSettings is <dataDir>/tailnet.json. Absent file means absent feature:
// publishing the board to a network is an explicit act, so the zero value is
// off.
type tailnetSettings struct {
	Enabled bool `json:"enabled"`
	// Hostname is the name the node takes in the tailnet, and therefore half of
	// the address the phone opens. Empty lets tsnet name it after the binary.
	Hostname string `json:"hostname,omitempty"`
	// AuthKey registers the node without a browser. Empty means the first run
	// prints (and opens) a login URL instead.
	AuthKey string `json:"authKey,omitempty"`
	// AllowedLogins are the tailnet users allowed to reach the board. Empty
	// means the user this node belongs to — the person who logged it in — and
	// nobody else, which is the right default for a tailnet shared with others.
	AllowedLogins []string `json:"allowedLogins,omitempty"`
}

func loadTailnetSettings(path string) (tailnetSettings, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return tailnetSettings{}, nil
	}
	if err != nil {
		return tailnetSettings{}, err
	}
	var cfg tailnetSettings
	if err := json.Unmarshal(data, &cfg); err != nil {
		return tailnetSettings{}, fmt.Errorf("tailnet: %s: %w", path, err)
	}
	return cfg, nil
}

// saveTailnetSettings writes what the panel changed. The file is also edited by
// hand — an auth key, an extra allowed login — so it is written indented, and
// the keys the panel does not know about survive because the panel is handed
// the whole struct to change, not a fragment.
func saveTailnetSettings(path string, cfg tailnetSettings) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

// tailnetState is what the settings panel shows, and it is the whole of what
// anybody outside this file needs to know. Bringing a node up is not instant —
// a first run waits for a person to follow a login URL — so "joining" and
// "login" are states, not moments.
type tailnetState struct {
	Enabled  bool   `json:"enabled"`
	Hostname string `json:"hostname"`
	// Status is off | joining | login | on | error.
	Status   string `json:"status"`
	URL      string `json:"url,omitempty"`
	LoginURL string `json:"loginUrl,omitempty"`
	Error    string `json:"error,omitempty"`
	// Path is where the settings live, so the panel can say it when something
	// has to be edited by hand (an auth key, a guest login).
	Path string `json:"path"`
}

// tailnetController holds what the front door needs to publish itself and what
// the rest of the app needs to ask about it. It exists because the two halves
// arrive at different times: the settings are read at startup, while the
// handler to serve only exists once Wails has handed over its asset server —
// and later, because the switch in the settings panel can turn the door on and
// off long after both have arrived.
type tailnetController struct {
	stateDir string
	// path is where the settings are kept. It is shown in the UI: an auth key
	// or an extra allowed login is still edited by hand.
	path string
	// openURL shows the login URL to the person sitting in front of the app.
	// A desktop app has no terminal anybody reads, and a first run that waits
	// silently for a login that was never asked for looks like a hang.
	openURL func(string)

	mu       sync.Mutex
	settings tailnetSettings
	// build makes a front door for a given authority. It arrives from the
	// front door itself and is kept, because turning the switch on later needs
	// it again.
	build func(allowedHost string) http.Handler
	door  *tailnetDoor
	state tailnetState
	// generation invalidates a node that is still coming up when the switch is
	// turned off, so a slow login cannot publish a door nobody asked for.
	generation int
}

func newTailnetController(settingsPath, stateDir string, openURL func(string)) (*tailnetController, error) {
	cfg, err := loadTailnetSettings(settingsPath)
	if err != nil {
		return nil, err
	}
	c := &tailnetController{stateDir: stateDir, path: settingsPath, openURL: openURL, settings: cfg}
	c.state = tailnetState{Enabled: cfg.Enabled, Hostname: cfg.Hostname, Status: "off", Path: settingsPath}
	return c, nil
}

// publish hands over the front door and starts the node if the settings say so.
// build is called with the tailnet authority the page will be served under,
// because the front door's guards are keyed to the address it was published as
// (frontdoor.go): the loopback handler would refuse every request that arrives
// here.
func (c *tailnetController) publish(build func(allowedHost string) http.Handler) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.build = build
	enabled := c.settings.Enabled
	c.mu.Unlock()

	if !enabled {
		log.Printf("tailnet: off; the settings panel turns it on, or %s does", c.path)
		return
	}
	// A launch is not somebody asking for a login. An app that opens a browser
	// tab by itself while starting up is a startled person, and a node that
	// needs one says so in the panel, with a button, whenever they come to look.
	c.start(false)
}

// settingsCopy is the settings as they stand, so a caller changing two fields
// does not drop the ones it knows nothing about.
func (c *tailnetController) settingsCopy() tailnetSettings {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.settings
}

// status is what the UI reads.
func (c *tailnetController) status() tailnetState {
	if c == nil {
		return tailnetState{Status: "off"}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// update saves the settings and makes the door match them. Turning the switch
// off stops a running node; turning it on starts one, which is why build had to
// be kept.
func (c *tailnetController) update(next tailnetSettings) (tailnetState, error) {
	if c == nil {
		return tailnetState{Status: "off"}, errors.New("tailnet: unavailable")
	}
	if next.Enabled && strings.TrimSpace(next.Hostname) == "" {
		return c.status(), errors.New("укажите имя машины в сети")
	}
	if err := saveTailnetSettings(c.path, next); err != nil {
		return c.status(), err
	}

	c.stop()
	c.mu.Lock()
	c.settings = next
	c.state = tailnetState{Enabled: next.Enabled, Hostname: next.Hostname, Status: "off", Path: c.path}
	hasDoor := c.build != nil
	c.mu.Unlock()

	if next.Enabled && hasDoor {
		// This one is somebody asking, so the login page is opened for them.
		c.start(true)
	}
	return c.status(), nil
}

// start brings a node up in the background: the window must not wait for a
// login that may never come. asked says whether a person is waiting for this
// right now, which is the only time a browser window may be opened by itself.
func (c *tailnetController) start(asked bool) {
	c.mu.Lock()
	c.generation++
	generation := c.generation
	cfg := c.settings
	build := c.build
	c.state = tailnetState{Enabled: true, Hostname: cfg.Hostname, Status: "joining", Path: c.path}
	c.mu.Unlock()

	if build == nil {
		return
	}
	log.Printf("tailnet: joining as %q (this can take a moment, and the first run needs a login)", cfg.Hostname)

	go func() {
		announce := func(loginURL string) {
			c.mu.Lock()
			if c.generation == generation {
				c.state.Status = "login"
				c.state.LoginURL = loginURL
			}
			c.mu.Unlock()
			if asked && c.openURL != nil {
				c.openURL(loginURL)
			}
		}

		door, err := startTailnetDoor(cfg, c.stateDir, announce, build)

		c.mu.Lock()
		stale := c.generation != generation
		if !stale {
			if err != nil {
				c.state.Status = "error"
				c.state.Error = err.Error()
			} else {
				c.door = door
				c.state.Status = "on"
				c.state.URL = "https://" + door.host + mobilePath
				c.state.LoginURL = ""
				c.state.Error = ""
			}
		}
		c.mu.Unlock()

		if err != nil {
			log.Printf("tailnet: not published: %v", err)
			return
		}
		if stale {
			// Somebody turned the switch off while this was logging in.
			door.close()
			return
		}
	}()
}

// stop closes a running node and invalidates one that is still coming up.
func (c *tailnetController) stop() {
	c.mu.Lock()
	c.generation++
	door := c.door
	c.door = nil
	c.mu.Unlock()
	if door != nil {
		door.close()
	}
}

func (c *tailnetController) close() {
	if c == nil {
		return
	}
	c.stop()
}

// mobilePath is the page a phone is given, rather than the board's front page:
// the address in the settings panel is there to be typed into a phone.
const mobilePath = "/m"

// tailnetDoor is one running node with the front door on it.
type tailnetDoor struct {
	srv    *tsnet.Server
	server *http.Server
	host   string
}

// startTailnetDoor brings one node up and serves the front door on it.
// announce is called with the login URL if the node has no credentials yet.
func startTailnetDoor(cfg tailnetSettings, stateDir string, announce func(string), build func(allowedHost string) http.Handler) (*tailnetDoor, error) {
	if err := os.MkdirAll(stateDir, 0o700); err != nil {
		return nil, fmt.Errorf("state dir: %w", err)
	}
	srv := &tsnet.Server{
		Hostname: cfg.Hostname,
		Dir:      stateDir,
		AuthKey:  cfg.AuthKey,
		UserLogf: func(format string, a ...any) { log.Printf("tailnet: "+format, a...) },
	}

	ctx := context.Background()
	if err := srv.Start(); err != nil {
		return nil, err
	}
	lc, err := srv.LocalClient()
	if err != nil {
		_ = srv.Close()
		return nil, err
	}
	// Watch for the login URL while Up blocks. It appears only when the node
	// has no credentials yet, so on every later launch this finds nothing and
	// the node is simply up.
	go showLoginURL(ctx, lc, announce)

	status, err := srv.Up(ctx)
	if err != nil {
		_ = srv.Close()
		return nil, err
	}

	domains := srv.CertDomains()
	if len(domains) == 0 {
		_ = srv.Close()
		return nil, errors.New("no cert domain: is MagicDNS or HTTPS off for this tailnet?")
	}
	host := domains[0]

	// TLS because the client is a phone: a webview refuses plain HTTP by
	// default (App Transport Security on iOS, the cleartext policy on Android),
	// and a tailnet certificate is a real one, so nothing has to be excused.
	listener, err := srv.ListenTLS("tcp", ":443")
	if err != nil {
		_ = srv.Close()
		return nil, err
	}

	gate := tailnetGate(build(host), func(ctx context.Context, remoteAddr string) (string, error) {
		who, err := lc.WhoIs(ctx, remoteAddr)
		if err != nil {
			return "", err
		}
		if who.UserProfile == nil {
			return "", errors.New("no user profile")
		}
		return who.UserProfile.LoginName, nil
	}, allowedLogins(cfg, selfLogin(status)))

	server := &http.Server{Handler: gate}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("tailnet: stopped: %v", err)
		}
	}()
	log.Printf("tailnet: board published at https://%s/", host)
	return &tailnetDoor{srv: srv, server: server, host: host}, nil
}

func (d *tailnetDoor) close() {
	if d.server != nil {
		_ = d.server.Shutdown(context.Background())
	}
	if d.srv != nil {
		_ = d.srv.Close()
	}
}

// allowedLogins answers who may reach the board. The default — the user this
// node was logged in as — is deliberately narrow: a tailnet often has other
// people on it, and what is behind this door is a shell.
func allowedLogins(cfg tailnetSettings, self string) func(string) bool {
	allowed := map[string]bool{}
	for _, login := range cfg.AllowedLogins {
		allowed[strings.ToLower(login)] = true
	}
	if len(allowed) == 0 && self != "" {
		allowed[strings.ToLower(self)] = true
	}
	return func(login string) bool { return login != "" && allowed[strings.ToLower(login)] }
}

// selfLogin is the login name this node belongs to.
func selfLogin(status *ipnstate.Status) string {
	if status == nil || status.Self == nil {
		return ""
	}
	if profile, ok := status.User[status.Self.UserID]; ok {
		return profile.LoginName
	}
	return ""
}

// peerIdentity answers who is on the other end of a connection, by tailnet
// login name. It is a function rather than the client itself so the gate can be
// tested without a tailnet.
type peerIdentity func(ctx context.Context, remoteAddr string) (string, error)

// tailnetGate refuses anyone the settings do not name. It stands in front of
// everything — the page, the API, both sockets — because the session token that
// makes a request "authenticated" to the board is handed out by the page itself
// (proxy.go), so letting a stranger fetch the page is letting them in.
func tailnetGate(next http.Handler, whoIs peerIdentity, allowed func(string) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		login, err := whoIs(r.Context(), r.RemoteAddr)
		if err != nil {
			log.Printf("tailnet: refusing %s: %v", r.RemoteAddr, err)
			http.Error(w, "unknown caller", http.StatusForbidden)
			return
		}
		if !allowed(login) {
			log.Printf("tailnet: refusing %s (%s): not in allowedLogins", r.RemoteAddr, login)
			http.Error(w, "not allowed here", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// showLoginURL polls until the node reports a login URL, then opens it once.
// Polling rather than reading it off UserLogf: the message is a log line whose
// wording is not ours, and the status field is the same fact without parsing.
func showLoginURL(ctx context.Context, lc *local.Client, openURL func(string)) {
	deadline := time.Now().Add(5 * time.Minute)
	for time.Now().Before(deadline) {
		status, err := lc.StatusWithoutPeers(ctx)
		if err == nil {
			if status.AuthURL != "" {
				log.Printf("tailnet: log this device in at %s", status.AuthURL)
				if openURL != nil {
					openURL(status.AuthURL)
				}
				return
			}
			if status.BackendState == "Running" {
				return
			}
		}
		time.Sleep(time.Second)
	}
}
