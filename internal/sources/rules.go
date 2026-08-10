package sources

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"text/template"
)

// Everything in this file is pure: rules decide, the manager acts. That split
// is what lets the decisions be tested without a board.

// Match reports whether the item satisfies every field the match names. An
// empty match is a catch-all, so a rule with no conditions is the last one in
// the list rather than a mistake.
func (m Match) Match(it Item) bool {
	if m.IsZero() {
		return true
	}
	if !matchRegexp(m.Title, it.Title) || !matchRegexp(m.Body, it.Body) {
		return false
	}
	if len(m.Labels) > 0 && !anyLabel(m.Labels, it.Labels) {
		return false
	}
	for prop, expr := range m.Props {
		if !matchRegexp(expr, propValue(it.Props, prop)) {
			return false
		}
	}
	return true
}

// matchRegexp treats an unparseable expression as "does not match" rather than
// as "matches everything": Validate refused it when it was typed, so a broken
// one here means a hand-edited file, and the safe reading of a broken condition
// is that it did not fire.
func matchRegexp(expr, value string) bool {
	if expr == "" {
		return true
	}
	re, err := compileMatch(expr)
	if err != nil {
		return false
	}
	return re.MatchString(value)
}

// compileMatch is the one place a rule's expression is turned into a regexp, so
// validation and matching cannot disagree about what it means.
//
// Matching ignores case, like every name comparison in this application:
// somebody writing «доставк» means the notification that says «Доставка», and a
// rule that silently misses it is worse than no rule. The flag is a prefix
// rather than a wrapper, so a rule that needs case can still say (?-i).
func compileMatch(expr string) (*regexp.Regexp, error) {
	return regexp.Compile("(?i)" + expr)
}

func anyLabel(want, have []string) bool {
	for _, w := range want {
		for _, h := range have {
			if strings.EqualFold(w, h) {
				return true
			}
		}
	}
	return false
}

// propValue looks a property up case-insensitively, the way property names are
// matched everywhere else here.
func propValue(props map[string]string, name string) string {
	if v, ok := props[name]; ok {
		return v
	}
	for k, v := range props {
		if strings.EqualFold(k, name) {
			return v
		}
	}
	return ""
}

// FirstMatch returns the first rule the item satisfies.
func FirstMatch(rules []Rule, it Item) (Rule, bool) {
	for _, r := range rules {
		if r.When.Match(it) {
			return r, true
		}
	}
	return Rule{}, false
}

// RenderProps expands a rule's property templates over the item. A template
// that fails is left out rather than failing the item: a card with one empty
// field is worth more than no card.
func RenderProps(props map[string]string, it Item) map[string]string {
	if len(props) == 0 {
		return nil
	}
	out := make(map[string]string, len(props))
	for name, tmpl := range props {
		value, err := renderTemplate(tmpl, it)
		if err != nil {
			continue
		}
		if value = strings.TrimSpace(value); value != "" {
			out[name] = value
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func renderTemplate(text string, it Item) (string, error) {
	// Without a template action there is nothing to expand, and parsing is the
	// expensive half — most property values are constants.
	if !strings.Contains(text, "{{") {
		return text, nil
	}
	t, err := template.New("prop").Option("missingkey=zero").Parse(text)
	if err != nil {
		return "", err
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, it); err != nil {
		return "", err
	}
	return buf.String(), nil
}

// CardFor builds the card a rule asks for. The column is deliberately not among
// the properties: a card is created where nothing happens to it and moved
// afterwards, because the trigger fires on a change of the column property and
// a card created straight into a working column would start nothing.
func CardFor(r Rule, it Item) CardSpec {
	title := strings.TrimSpace(it.Title)
	if title == "" {
		title = "Без заголовка"
	}
	return CardSpec{
		Title:      title,
		Body:       body(it),
		URL:        strings.TrimSpace(it.URL),
		Properties: RenderProps(r.Props, it),
	}
}

// body is the card's text: what the item said, and a link back to it. The link
// is repeated here even when a property carries it, because a board without
// that property would otherwise lose the only way back to the original.
func body(it Item) string {
	parts := make([]string, 0, 2)
	if b := strings.TrimSpace(it.Body); b != "" {
		parts = append(parts, b)
	}
	if u := strings.TrimSpace(it.URL); u != "" {
		parts = append(parts, u)
	}
	return strings.Join(parts, "\n\n")
}

// UpdateComment is what a changed item says on the card it already has. It is a
// comment and never a rewrite of the description: the description may have been
// edited by a person.
func updateComment(it Item) string {
	var b strings.Builder
	b.WriteString("Источник обновил запись.")
	if t := strings.TrimSpace(it.Title); t != "" {
		fmt.Fprintf(&b, "\n\n**%s**", t)
	}
	if body := strings.TrimSpace(it.Body); body != "" {
		fmt.Fprintf(&b, "\n\n%s", body)
	}
	if u := strings.TrimSpace(it.URL); u != "" {
		fmt.Fprintf(&b, "\n\n%s", u)
	}
	return b.String()
}
