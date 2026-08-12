package boardadapter

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io/fs"
	"path"
	"strings"
	"testing"

	"github.com/artipop/xciii/server/model"
)

// A template is JSON nobody compiles, embedded in the binary and read once on
// first launch — so a mistake in one is invisible until somebody opens the
// selector and finds a board missing or empty. These read what is embedded.

func embeddedTemplates(t *testing.T) []string {
	t.Helper()
	files, err := fs.Glob(templateFiles, "templates/*.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no templates are embedded — the selector would have nothing to offer")
	}
	return files
}

type archiveLine struct {
	Type string `json:"type"`
	Data struct {
		ID       string         `json:"id"`
		Type     string         `json:"type"`
		Title    string         `json:"title"`
		ParentID string         `json:"parentId"`
		RootID   string         `json:"rootId"`
		Fields   map[string]any `json:"fields"`
	} `json:"data"`
}

func readTemplate(t *testing.T, file string) []archiveLine {
	t.Helper()
	data, err := templateFiles.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var lines []archiveLine
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 0, 1<<20), 1<<22)
	for sc.Scan() {
		if len(bytes.TrimSpace(sc.Bytes())) == 0 {
			continue
		}
		var line archiveLine
		if err := json.Unmarshal(sc.Bytes(), &line); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
		lines = append(lines, line)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("%s: %v", file, err)
	}
	return lines
}

// The importer reads the first line as the board and hangs everything else off
// it; a file that opens with a card imports as a board named after that card.
func TestEveryTemplateOpensWithItsBoard(t *testing.T) {
	for _, file := range embeddedTemplates(t) {
		lines := readTemplate(t, file)
		if len(lines) == 0 {
			t.Errorf("%s is empty", file)
			continue
		}
		board := lines[0].Data
		if board.Type != "board" {
			t.Errorf("%s opens with a %q, not a board", file, board.Type)
			continue
		}
		if strings.TrimSpace(board.Title) == "" {
			t.Errorf("%s has no title, so the selector would offer it as \"Untitled\"", file)
		}
		for _, line := range lines[1:] {
			if line.Data.RootID != board.ID {
				t.Errorf("%s: %q belongs to another board (%q)", file, line.Data.Title, line.Data.RootID)
			}
		}
	}
}

// The slug is how an installed template is recognised on the next launch: ids
// are regenerated on import and titles are the user's to change, so a template
// without one is installed again on every version bump, beside the last copy.
func TestEveryTemplateCarriesTheSlugOfItsFile(t *testing.T) {
	for _, file := range embeddedTemplates(t) {
		board := readTemplate(t, file)[0].Data
		properties, _ := board.Fields["properties"].(map[string]any)
		slug, _ := properties[TemplateMarkerProperty].(string)
		if want := strings.TrimSuffix(path.Base(file), ".jsonl"); slug != want {
			t.Errorf("%s says it is %q; the importer will look for %q", file, slug, want)
		}
	}
}

// What the selector offers has to be what the app can run: a template that
// brings no columns and no routes is a board that does nothing when a card is
// dragged, which is the one thing the upstream templates already are.
func TestEveryTemplateBringsItsOwnAutomation(t *testing.T) {
	for _, file := range embeddedTemplates(t) {
		board := readTemplate(t, file)[0].Data
		properties, _ := board.Fields["properties"].(map[string]any)
		for _, key := range []string{"xciiiColumns", "xciiiFlows"} {
			list, ok := properties[key].([]any)
			if !ok || len(list) == 0 {
				t.Errorf("%s (%s) ships no %s", file, board.Title, key)
			}
		}
	}
}

// Whatever a file says about itself, a template is what the importer stamps it
// as — open, so it is offered without anybody being a member of it, and at this
// build's version, which is what decides when it is replaced.
func TestTheImporterDecidesWhatATemplateIs(t *testing.T) {
	board := &model.Board{Type: model.BoardTypePrivate}
	if !asTemplate(board, TemplateVersion) {
		t.Fatal("the modifier dropped the board")
	}
	if !board.IsTemplate || board.Type != model.BoardTypeOpen {
		t.Errorf("board is %+v", board)
	}
	if board.TemplateVersion != TemplateVersion {
		t.Errorf("version %d, expected %d", board.TemplateVersion, TemplateVersion)
	}
	if board.CreatedBy != model.SystemUserID {
		t.Errorf("created by %q: only a board of ours may be replaced on an upgrade", board.CreatedBy)
	}
}

func TestTemplateSlugIsReadFromTheBoardItself(t *testing.T) {
	if got := templateSlug(nil); got != "" {
		t.Errorf("nil board: %q", got)
	}
	if got := templateSlug(&model.Board{}); got != "" {
		t.Errorf("board without properties: %q", got)
	}
	board := &model.Board{Properties: map[string]any{TemplateMarkerProperty: "home-chores"}}
	if got := templateSlug(board); got != "home-chores" {
		t.Errorf("got %q", got)
	}
}

// Every template names the card property that holds the projects, by id.
// Making a board from a template duplicates it without renumbering the card
// properties, so the id the template writes is the id the new board has — and
// that is what lets the app find the field without knowing what it is called.
// A field recognised by its name was a field nobody could rename and a board in
// another language could never have.
func TestEveryTemplateNamesItsProjectPropertyByID(t *testing.T) {
	for _, file := range embeddedTemplates(t) {
		board := readTemplate(t, file)[0].Data

		properties, _ := board.Fields["properties"].(map[string]any)
		propID, _ := properties["xciiiProjectProperty"].(string)
		if propID == "" {
			t.Errorf("%s: no xciiiProjectProperty", file)
			continue
		}

		cardProperties, _ := board.Fields["cardProperties"].([]any)
		found := false
		for _, raw := range cardProperties {
			prop, _ := raw.(map[string]any)
			if id, _ := prop["id"].(string); id != propID {
				continue
			}
			found = true
			if propType, _ := prop["type"].(string); propType != "multiSelect" {
				t.Errorf("%s: the projects property is a %q, and a card belongs to more than one project", file, propType)
			}
		}
		if !found {
			t.Errorf("%s: xciiiProjectProperty names %q, which the board has not got", file, propID)
		}
	}
}
