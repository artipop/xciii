package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/artipop/xciii/server/model"
	"github.com/artipop/xciii/server/services/auth"
	"github.com/artipop/xciii/server/utils"
)

// Team mode is what turns this install from one person's board into several
// people's (docs/teamwork.md).
//
// It is a mode of the *install*, not a build: the same binary runs both, and
// the switch is a file under the data directory, read once at startup. That is
// deliberate — which mode the board server runs in is decided when it is
// constructed (the session token below), so making it a runtime flag would be a
// switch that lies about what the running server is doing.
//
// The two modes differ in exactly one thing: whether the board server is given
// a single-user token. With one, the API synthesizes a session for every
// request and nobody logs in; without one, /login and /register are open and
// every request carries a real session.
//
// **The person at the machine keeps their identity.** Everything made in
// single-user mode — boards, memberships, categories, card assignments — names
// the user id `single-user`, so turning the mode on registers the owner's
// account *under that id* rather than making a second one. Nothing has to be
// moved, and turning the mode back off hands the same data back to the
// synthesized session. What it costs is stated in docs/deferred.md: a write the
// machine makes on the owner's behalf is authored by the owner.

// teamSettings is <dataDir>/team/settings.json. An absent file means an absent
// team, which is the state every install starts in.
type teamSettings struct {
	Enabled bool `json:"enabled"`
}

func loadTeamSettings(path string) (teamSettings, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return teamSettings{}, nil
	}
	if err != nil {
		return teamSettings{}, err
	}
	var cfg teamSettings
	if err := json.Unmarshal(data, &cfg); err != nil {
		return teamSettings{}, fmt.Errorf("team: %s: %w", path, err)
	}
	return cfg, nil
}

func saveTeamSettings(path string, cfg teamSettings) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

// teamState is what the settings panel shows.
//
// Running is what the server was started with and Enabled is what the file
// says; they differ between the switch being thrown and the app being restarted,
// which is the one thing the panel has to say out loud.
type teamState struct {
	Enabled bool `json:"enabled"`
	Running bool `json:"running"`
	// Owner is the username of the account that holds this install's own
	// identity, empty until somebody names themselves.
	Owner string `json:"owner"`
	// Invite is the signup token the second person registers with. Only ever
	// filled while the mode is running: before that there is nobody to invite.
	Invite string `json:"invite"`
}

// teamBoard is the half of the board server this needs: the account that holds
// the install's identity, the team's signup token, and whether a token names a
// live session. Named as an interface rather than taking *app.App so the
// decisions below can be tested without a database — every one of them is about
// what to do, not about SQL.
type teamBoard interface {
	GetUser(id string) (*model.User, error)
	GetUserByUsername(username string) (*model.User, error)
	RegisterUserWithID(id, username, email, password string) error
	GetRootTeam() (*model.Team, error)
	UpsertTeamSignupToken(team model.Team) error
	GetSession(token string) (*model.Session, error)
}

// teamController owns the settings file and the account behind it. Every method
// tolerates a nil receiver, as the tailnet controller's do, so a data directory
// that could not be opened costs the feature and not the app.
type teamController struct {
	mu sync.Mutex

	path     string
	settings teamSettings
	// running is what the board server was actually started in, which is what
	// decides whether a restart is owed.
	running bool
	app     teamBoard
}

func newTeamController(path string) (*teamController, error) {
	cfg, err := loadTeamSettings(path)
	if err != nil {
		return nil, err
	}
	return &teamController{path: path, settings: cfg, running: cfg.Enabled}, nil
}

// enabled is read at startup to decide whether the board server gets a
// single-user token.
func (c *teamController) enabled() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.settings.Enabled
}

// setApp hands over the board once it is running: the account and the invite
// token are the board's own tables, and the controller is built before it.
func (c *teamController) setApp(a teamBoard) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.app = a
}

func (c *teamController) state() teamState {
	if c == nil {
		return teamState{}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stateLocked()
}

func (c *teamController) stateLocked() teamState {
	out := teamState{Enabled: c.settings.Enabled, Running: c.running}
	if c.app == nil {
		return out
	}
	if user, err := c.owner(); err == nil && user != nil {
		out.Owner = user.Username
	}
	// An invite is only meaningful while the mode is running: /register refuses
	// every caller while the server holds a single-user token, so handing out a
	// link before the restart would be handing out a dead one.
	if c.running {
		if team, err := c.app.GetRootTeam(); err == nil && team != nil {
			out.Invite = team.SignupToken
		}
	}
	return out
}

// owner is the account holding this install's own identity, or nil when nobody
// has named themselves yet. Absence is not an error here — it is the ordinary
// state of an install that has never been a team — and the store reports it as
// one.
func (c *teamController) owner() (*model.User, error) {
	user, err := c.app.GetUser(model.SingleUser)
	if model.IsErrNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

// enable names the person at this machine and turns the mode on. It takes
// effect at the next launch, which the state says by disagreeing with itself.
func (c *teamController) enable(username, password string) (teamState, error) {
	if c == nil {
		return teamState{}, errors.New("командный режим недоступен")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return teamState{}, errors.New("доска ещё не готова")
	}

	username = strings.TrimSpace(username)
	owner, err := c.owner()
	if err != nil {
		return teamState{}, err
	}
	if owner == nil {
		// The one moment a password is asked for. An account that already
		// exists is not asked again — this is the switch coming back on, and
		// the way to change a password is to change a password.
		if username == "" {
			return teamState{}, errors.New("нужно имя пользователя")
		}
		if err := auth.IsPasswordValid(password, auth.PasswordSettings{MinimumLength: 6}); err != nil {
			return teamState{}, fmt.Errorf("пароль: %w", err)
		}
		if taken, err := c.app.GetUserByUsername(username); err == nil && taken != nil {
			return teamState{}, fmt.Errorf("имя %q уже занято", username)
		}
		// No email: this account is created here rather than through
		// /register, and an address nobody asked for is an address nobody can
		// be reached at. The people invited afterwards give their own.
		if err := c.app.RegisterUserWithID(model.SingleUser, username, "", password); err != nil {
			return teamState{}, err
		}
	}

	next := c.settings
	next.Enabled = true
	if err := saveTeamSettings(c.path, next); err != nil {
		return teamState{}, err
	}
	c.settings = next
	return c.stateLocked(), nil
}

// disable puts the install back to one person. The account and everything it
// owns stay exactly where they are: the synthesized session that takes over
// carries the same id.
func (c *teamController) disable() (teamState, error) {
	if c == nil {
		return teamState{}, errors.New("командный режим недоступен")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	next := c.settings
	next.Enabled = false
	if err := saveTeamSettings(c.path, next); err != nil {
		return teamState{}, err
	}
	c.settings = next
	return c.stateLocked(), nil
}

// regenerateInvite mints a new signup token, which is how a link handed to the
// wrong person is taken back.
func (c *teamController) regenerateInvite() (teamState, error) {
	if c == nil {
		return teamState{}, errors.New("командный режим недоступен")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.app == nil {
		return teamState{}, errors.New("доска ещё не готова")
	}
	team, err := c.app.GetRootTeam()
	if err != nil {
		return teamState{}, err
	}
	team.SignupToken = utils.NewID(utils.IDTypeToken)
	if err := c.app.UpsertTeamSignupToken(*team); err != nil {
		return teamState{}, err
	}
	return c.stateLocked(), nil
}

// sessionValid answers the front door: is this token a live board session.
//
// It is the whole of what the guard needs to know — *which* person is behind it
// is the board's own business, and every route the guard stands in front of is
// about this machine rather than about a board.
func (c *teamController) sessionValid(token string) bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	a := c.app
	c.mu.Unlock()
	if a == nil || token == "" {
		return false
	}
	session, err := a.GetSession(token)
	return err == nil && session != nil
}

// sessionCookie is the name the page keeps its board session token under for
// the front door's benefit.
//
// The page authenticates to the *board* with an Authorization header it sets
// itself. Nothing of ours can do that: the Wails runtime makes its own fetches
// and a WebSocket carries no headers a browser lets us set — so the same token
// travels a second way, as a cookie the page writes beside the one it already
// keeps in localStorage. It is not HttpOnly on purpose: the page writes it, and
// the value is one a script on this origin can read anyway.
const sessionCookie = "xciiiSession"

// requireSession refuses a request that carries no live board session. It is
// installed only in team mode: in single-user mode there is no session to
// carry, and the front door's own guards (same origin, expected Host) are the
// whole of the protection — which is what nothing authenticating a user means.
func requireSession(next http.Handler, valid func(string) bool) http.Handler {
	if valid == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err != nil || !valid(cookie.Value) {
			http.Error(w, "not logged in", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
