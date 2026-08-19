package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/artipop/xciii/server/model"
)

// fakeBoard is the board as the team controller sees it: a users table with one
// row in it at most, and a team with a token.
type fakeBoard struct {
	users    map[string]*model.User
	team     model.Team
	sessions map[string]bool
	// registered records what the controller asked for, since the id it picks
	// is the whole point of the feature.
	registered []string
}

func newFakeBoard() *fakeBoard {
	return &fakeBoard{
		users:    map[string]*model.User{},
		team:     model.Team{ID: "0", SignupToken: "first-token"},
		sessions: map[string]bool{},
	}
}

func (b *fakeBoard) GetUser(id string) (*model.User, error) {
	if user, ok := b.users[id]; ok {
		return user, nil
	}
	return nil, model.NewErrNotFound("user " + id)
}

func (b *fakeBoard) GetUserByUsername(username string) (*model.User, error) {
	for _, user := range b.users {
		if user.Username == username {
			return user, nil
		}
	}
	return nil, model.NewErrNotFound("user " + username)
}

func (b *fakeBoard) RegisterUserWithID(id, username, email, password string) error {
	b.registered = append(b.registered, id)
	b.users[id] = &model.User{ID: id, Username: username, Email: email}
	return nil
}

func (b *fakeBoard) GetRootTeam() (*model.Team, error) {
	team := b.team
	return &team, nil
}

func (b *fakeBoard) UpsertTeamSignupToken(team model.Team) error {
	b.team = team
	return nil
}

func (b *fakeBoard) GetSession(token string) (*model.Session, error) {
	if b.sessions[token] {
		return &model.Session{Token: token}, nil
	}
	return nil, model.NewErrNotFound("session")
}

func teamAt(t *testing.T) (*teamController, *fakeBoard) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "settings.json")
	controller, err := newTeamController(path)
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	board := newFakeBoard()
	controller.setApp(board)
	return controller, board
}

// An install nobody has said anything about is one person's, which is what the
// absent settings file has to mean: the app ships without one.
func TestAnInstallWithNoSettingsIsOnePersons(t *testing.T) {
	controller, _ := teamAt(t)
	if controller.enabled() {
		t.Fatal("a fresh install reports itself as a team")
	}
	if state := controller.state(); state.Enabled || state.Running || state.Owner != "" {
		t.Fatalf("unexpected state: %+v", state)
	}
}

// The whole point of the feature: the person at the machine is registered under
// the id everything they have already made points at, so nothing has to be
// moved for their boards to still be theirs.
func TestTheOwnerTakesOverTheIdentityTheInstallAlreadyHad(t *testing.T) {
	controller, board := teamAt(t)

	state, err := controller.enable("artem", "sixchars")
	if err != nil {
		t.Fatalf("enable: %v", err)
	}
	if len(board.registered) != 1 || board.registered[0] != model.SingleUser {
		t.Fatalf("registered under %v, want the single-user id", board.registered)
	}
	if state.Owner != "artem" {
		t.Fatalf("owner is %q", state.Owner)
	}
	// Enabled and running disagree until the app is restarted, which is what
	// the panel reads to say so.
	if !state.Enabled || state.Running {
		t.Fatalf("expected a restart to be owed: %+v", state)
	}
}

// Coming back to a mode that was on before must not ask for a password again,
// and must not make a second account.
func TestTurningTheTeamOnAgainKeepsTheAccountItAlreadyHas(t *testing.T) {
	controller, board := teamAt(t)
	if _, err := controller.enable("artem", "sixchars"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if _, err := controller.disable(); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if _, err := controller.enable("", ""); err != nil {
		t.Fatalf("re-enable: %v", err)
	}
	if len(board.registered) != 1 {
		t.Fatalf("registered %d accounts, want 1", len(board.registered))
	}
}

// A password nobody could log in with is worse than no team at all, so the one
// moment it is asked for is the one moment it is checked.
func TestATeamIsRefusedWithoutAUsableAccount(t *testing.T) {
	controller, _ := teamAt(t)
	if _, err := controller.enable("", "sixchars"); err == nil {
		t.Fatal("a team with no username was accepted")
	}
	if _, err := controller.enable("artem", "short"); err == nil {
		t.Fatal("a five-character password was accepted")
	}
	if controller.enabled() {
		t.Fatal("a refused enable turned the mode on anyway")
	}
}

// The mode is a file, because the board server is constructed with the answer:
// what the next launch reads is the whole contract.
func TestTheModeSurvivesTheAppThatWroteIt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	first, err := newTeamController(path)
	if err != nil {
		t.Fatalf("new controller: %v", err)
	}
	first.setApp(newFakeBoard())
	if _, err := first.enable("artem", "sixchars"); err != nil {
		t.Fatalf("enable: %v", err)
	}

	next, err := newTeamController(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if !next.enabled() {
		t.Fatal("the next launch reads the install as one person's")
	}
	// And this time the server was started with it, so nothing is owed.
	next.setApp(newFakeBoard())
	if state := next.state(); !state.Running {
		t.Fatalf("expected the mode to be running: %+v", state)
	}
}

// An invite is a link handed to a person, and taking it back has to be possible
// — otherwise the only way to close a door is to turn the team off.
func TestANewInviteRetiresTheOldOne(t *testing.T) {
	controller, board := teamAt(t)
	if _, err := controller.enable("artem", "sixchars"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	controller.running = true

	before := controller.state().Invite
	if before != "first-token" {
		t.Fatalf("invite is %q", before)
	}
	state, err := controller.regenerateInvite()
	if err != nil {
		t.Fatalf("regenerate: %v", err)
	}
	if state.Invite == before || state.Invite == "" {
		t.Fatalf("invite did not change: %q", state.Invite)
	}
	if board.team.SignupToken != state.Invite {
		t.Fatal("the board kept a different token from the one shown")
	}
}

// Before the restart there is nobody to invite: /register refuses every caller
// while the server still holds a single-user token, so a link handed out then
// would be a dead one.
func TestNoInviteIsOfferedBeforeTheRestart(t *testing.T) {
	controller, _ := teamAt(t)
	if _, err := controller.enable("artem", "sixchars"); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if invite := controller.state().Invite; invite != "" {
		t.Fatalf("offered an invite before the restart: %q", invite)
	}
}

// The routes behind the guard start agents and open shells. In team mode a
// request that carries no live session is not one of the team's.
func TestTheGuardRefusesARequestWithNoSession(t *testing.T) {
	controller, board := teamAt(t)
	board.sessions["live"] = true

	guarded := requireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}), controller.sessionValid)

	for _, tc := range []struct {
		name   string
		cookie *http.Cookie
		want   int
	}{
		{"no cookie at all", nil, http.StatusUnauthorized},
		{"a token nobody issued", &http.Cookie{Name: sessionCookie, Value: "made-up"}, http.StatusUnauthorized},
		{"a live session", &http.Cookie{Name: sessionCookie, Value: "live"}, http.StatusTeapot},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// The call, not the script: the module itself is open (below).
			req := httptest.NewRequest(http.MethodPost, "/wails/runtime", nil)
			if tc.cookie != nil {
				req.AddCookie(tc.cookie)
			}
			rec := httptest.NewRecorder()
			guarded.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("got %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

// The runtime module is the one thing behind the guard a page without a session
// must still be able to fetch: it carries no authority, and refusing it left a
// login page unable to become a logged-in one — the browser caches a rejected
// dynamic import, and logging in does not reload the page.
func TestTheRuntimeModuleIsServedToAPageWithNoSessionYet(t *testing.T) {
	controller, _ := teamAt(t)

	guarded := requireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}), controller.sessionValid)

	for _, tc := range []struct {
		name   string
		method string
		path   string
		want   int
	}{
		{"the runtime module", http.MethodGet, "/wails/runtime.js", http.StatusTeapot},
		{"a call made through it", http.MethodPost, "/wails/runtime", http.StatusUnauthorized},
		{"anything else under it", http.MethodGet, "/wails/events", http.StatusUnauthorized},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			guarded.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.path, nil))
			if rec.Code != tc.want {
				t.Fatalf("got %d, want %d", rec.Code, tc.want)
			}
		})
	}
}

// In single-user mode there is no session to carry, and the guard has to be
// absent rather than closed — otherwise the app locks itself out of its own
// bound methods.
func TestWithNoTeamTheGuardStandsAside(t *testing.T) {
	guarded := requireSession(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}), nil)

	rec := httptest.NewRecorder()
	guarded.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/wails/runtime", nil))
	if rec.Code != http.StatusTeapot {
		t.Fatalf("got %d, want the handler to have run", rec.Code)
	}
}

// The page writes the cookie the guard reads, and the two names are in
// different languages: this is the one place they can be compared.
func TestTheBootstrapWritesTheCookieTheGuardReads(t *testing.T) {
	script := bootstrapScript("su-token")
	if !strings.Contains(script, sessionCookie+"=") {
		t.Fatalf("the bootstrap script writes no %q cookie", sessionCookie)
	}
}

// A page that could not load the runtime once has to be able to try again: the
// module map caches a rejected import, so the page has to drop its own handle
// on it or one bad moment lasts as long as the page does.
func TestTheBootstrapForgetsARuntimeImportThatFailed(t *testing.T) {
	script := bootstrapScript("")
	if !strings.Contains(script, "runtimePromise = null;") {
		t.Fatal("a failed runtime import is kept, so a bound call can never recover")
	}
}
