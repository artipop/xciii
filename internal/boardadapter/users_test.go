package boardadapter

import (
	"strings"
	"testing"

	"github.com/mattermost/focalboard/server/model"
)

func personSchema() model.PropSchema {
	return model.PropSchema{
		"prop-assignee":  {ID: "prop-assignee", Name: "Assignee", Type: "person"},
		"prop-reviewers": {ID: "prop-reviewers", Name: "Reviewers", Type: "multiPerson"},
		"prop-project":   {ID: "prop-project", Name: "repo_path", Type: "text"},
	}
}

func TestPersonPropertiesResolveToUsernames(t *testing.T) {
	props := map[string]any{
		"prop-assignee":  "uid-claude",
		"prop-reviewers": []any{"uid-codex", "uid-ghost"},
		"prop-project":   "/tmp/project",
	}
	lookups := 0
	resolver := newUserResolver(func(userID string) string {
		lookups++
		return map[string]string{"uid-claude": "claude", "uid-codex": "codex"}[userID]
	})

	names := personNames(props, personSchema(), resolver)
	if len(names) != 2 {
		t.Fatalf("person names = %v, want claude and codex", names)
	}
	joined := strings.Join(names, ",")
	if !strings.Contains(joined, "claude") || !strings.Contains(joined, "codex") {
		t.Errorf("person names = %v", names)
	}
	// An unknown id contributes no name — it must not be mistaken for one.
	if strings.Contains(joined, "uid-ghost") {
		t.Errorf("unknown user leaked into person names: %v", names)
	}

	// The same values are resolved once, whoever asks: BlockChanged runs on the
	// notify worker and this is a DB read per person value.
	block := &model.Block{ID: "card1", Fields: map[string]any{"properties": props}}
	parsed := namedProperties(block, personSchema(), resolver)
	if parsed["assignee"] != "claude" {
		t.Errorf("assignee prop = %q, want claude", parsed["assignee"])
	}
	if parsed["repo_path"] != "/tmp/project" {
		t.Errorf("unrelated props broken: %v", parsed)
	}
	if lookups != 3 {
		t.Errorf("lookups = %d, want 3 (one per distinct user id)", lookups)
	}
}

func TestNamedPropertiesSurvivesUnresolvableUsers(t *testing.T) {
	// No app (nil lookup) is the case in a browser/plugin build and in tests:
	// person values stay raw ids, and the rest of the map must still arrive.
	props := map[string]any{"prop-assignee": "uid-claude", "prop-project": "/tmp/project"}
	block := &model.Block{ID: "card1", Fields: map[string]any{"properties": props}}
	resolver := newUserResolver(nil)

	parsed := namedProperties(block, personSchema(), resolver)
	if parsed["repo_path"] != "/tmp/project" {
		t.Fatalf("props lost when a user cannot be resolved: %v", parsed)
	}
	if parsed["assignee"] != "uid-claude" {
		t.Errorf("assignee prop = %q, want the raw id", parsed["assignee"])
	}
	if names := personNames(props, personSchema(), resolver); len(names) != 0 {
		t.Errorf("person names = %v, want none", names)
	}
}

// A source's account is named after the source, because the board shows the
// username wherever it names an author — the inbox's own group headings among
// them — and a prefixed one would read as machinery rather than as «почта».
func TestASourceAccountIsNamedAfterTheSource(t *testing.T) {
	cases := map[string]string{
		"почта":          "почта",
		"  Телефон  ":    "телефон",
		"home assistant": "home-assistant",
		"gmail_work":     "gmail-work",
		// Anything a username may not hold is dropped rather than encoded: what
		// is left still names the source, and what was there is not a name.
		"почта (личная)": "почта-личная",
		"":               "",
	}
	for source, want := range cases {
		if got := sourceUsername(source); got != want {
			t.Errorf("sourceUsername(%q) = %q, want %q", source, got, want)
		}
	}
}
