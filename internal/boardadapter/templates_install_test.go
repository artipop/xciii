package boardadapter

import (
	"database/sql"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/mattermost/focalboard/server/app"
	"github.com/mattermost/focalboard/server/model"
	"github.com/mattermost/focalboard/server/server"
	"github.com/mattermost/focalboard/server/services/config"
	"github.com/mattermost/focalboard/server/services/permissions/localpermissions"

	"github.com/mattermost/mattermost/server/public/shared/mlog"
)

// Installing the templates is the half nothing else covers: the files are
// embedded, the ids are regenerated on import, and whether the four boards end
// up in the global team as templates — once, not once per launch — is decided
// by a store nobody sees until the app is opened. So this runs the real board
// server against a temporary database and looks.

func newTestApp(t *testing.T) *app.App {
	t.Helper()
	dir := t.TempDir()
	dsn := filepath.Join(dir, "board.db") + "?_busy_timeout=5000&_journal_mode=WAL"
	if db, err := sql.Open("sqlite3", dsn); err != nil {
		// The sqlite driver is registered by a build tag; without it there is
		// no store to import into (`go test -tags "json1 sqlite3"`).
		t.Skipf("no sqlite driver in this build: %v", err)
	} else {
		db.Close()
	}

	logger, err := mlog.NewLogger()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = logger.Shutdown() })

	cfg := &config.Configuration{
		DBType:            "sqlite3",
		DBConfigString:    dsn,
		DBTablePrefix:     "focalboard_",
		FilesDriver:       "local",
		FilesPath:         filepath.Join(dir, "files"),
		WebPath:           dir,
		AuthMode:          "native",
		SessionExpireTime: 259200000000,
	}
	store, err := server.NewStore(cfg, true, logger)
	if err != nil {
		t.Skipf("cannot open a board store here: %v", err)
	}
	t.Cleanup(func() { _ = store.Shutdown() })

	srv, err := server.New(server.Params{
		Cfg:                cfg,
		SingleUserToken:    "test-token",
		DBStore:            store,
		Logger:             logger,
		PermissionsService: localpermissions.New(store, logger),
	})
	if err != nil {
		t.Fatalf("cannot build the board server: %v", err)
	}
	t.Cleanup(srv.App().Shutdown)
	return srv.App()
}

func installedTemplates(t *testing.T, a *app.App) map[string]*model.Board {
	t.Helper()
	boards, err := a.GetTemplateBoards(model.GlobalTeamID, "")
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]*model.Board{}
	for _, board := range boards {
		if slug := templateSlug(board); slug != "" {
			if _, twice := out[slug]; twice {
				t.Errorf("%q is installed more than once", slug)
			}
			out[slug] = board
		}
	}
	return out
}

func TestTemplatesAreInstalledOnceAndStayThere(t *testing.T) {
	a := newTestApp(t)
	logger, _ := mlog.NewLogger()

	if err := ImportTemplates(a, logger); err != nil {
		t.Fatalf("first launch: %v", err)
	}
	first := installedTemplates(t, a)

	var slugs []string
	for slug, board := range first {
		slugs = append(slugs, slug)
		if !board.IsTemplate || board.Type != model.BoardTypeOpen {
			t.Errorf("%q is installed as %+v", slug, board)
		}
		if board.TemplateVersion != TemplateVersion {
			t.Errorf("%q is at version %d", slug, board.TemplateVersion)
		}
		if strings.TrimSpace(board.Title) == "" {
			t.Errorf("%q has no title", slug)
		}
	}
	sort.Strings(slugs)
	want := []string{"developer-tasks", "home-chores", "house-and-appliances", "shopping-and-meals"}
	if strings.Join(slugs, ",") != strings.Join(want, ",") {
		t.Fatalf("installed %v, expected %v", slugs, want)
	}

	// A second launch must find them and leave them alone — including their
	// ids, since a board somebody made from one keeps no link to it but the
	// registry's routes are filed under the board they were taken from.
	if err := ImportTemplates(a, logger); err != nil {
		t.Fatalf("second launch: %v", err)
	}
	for slug, board := range installedTemplates(t, a) {
		if first[slug] == nil || first[slug].ID != board.ID {
			t.Errorf("%q was reinstalled on the second launch", slug)
		}
	}
}

// The upgrade path: an edited template reaches an install that already has the
// old one, and reaches it as a replacement rather than as a second board with
// the same name.
func TestABumpedVersionReplacesTheInstalledCopy(t *testing.T) {
	a := newTestApp(t)
	logger, _ := mlog.NewLogger()
	if err := importTemplates(a, logger, 1); err != nil {
		t.Fatal(err)
	}
	before := installedTemplates(t, a)

	if err := importTemplates(a, logger, 2); err != nil {
		t.Fatal(err)
	}
	after := installedTemplates(t, a) // fails the test if any slug is there twice
	if len(after) != len(before) {
		t.Fatalf("%d templates installed, expected %d", len(after), len(before))
	}
	for slug, board := range after {
		if board.TemplateVersion != 2 {
			t.Errorf("%q is still at version %d", slug, board.TemplateVersion)
		}
		if board.ID == before[slug].ID {
			t.Errorf("%q was left as it was", slug)
		}
	}
}

// The cards and the automation have to survive the import, or the board arrives
// as a title with nothing behind it.
func TestAnInstalledTemplateKeepsItsCardsAndAutomation(t *testing.T) {
	a := newTestApp(t)
	logger, _ := mlog.NewLogger()
	if err := ImportTemplates(a, logger); err != nil {
		t.Fatal(err)
	}

	board := installedTemplates(t, a)["home-chores"]
	if board == nil {
		t.Fatal("«Домашние дела» is not installed")
	}
	if _, ok := board.Properties["acpColumns"]; !ok {
		t.Error("the board arrived without the columns it runs")
	}
	if _, ok := board.Properties["acpFlows"]; !ok {
		t.Error("the board arrived without its routes")
	}
	if len(board.CardProperties) == 0 {
		t.Error("the board arrived with no card properties")
	}

	cards, err := a.GetBlocks(board.ID, "", string(model.TypeCard))
	if err != nil {
		t.Fatal(err)
	}
	if len(cards) == 0 {
		t.Error("the board arrived with no cards")
	}
}
