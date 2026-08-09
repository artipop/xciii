package sources

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The registry lives in its own file beside the ACP one, for the reason the
// package doc gives: an install with no agents still has sources.

// Rule actions.
const (
	ActionCard    = "card"    // create a card
	ActionComment = "comment" // comment on the card this item already has
	ActionDrop    = "drop"    // deliberately ignore
)

// Actions lists every accepted action, in the order the UI offers them.
var Actions = []string{ActionCard, ActionComment, ActionDrop}

// DefaultInbox is the column an item lands in when no rule sent it anywhere
// else. There is no matching default for the *property* those columns belong
// to: that one is asked of the board (BoardWriter.ColumnProperty), because a
// constant here was "Status" while every board this app ships says «Статус»,
// and the mismatch filed nothing anywhere.
const DefaultInbox = "Входящие"

// Match is what a rule looks at. An empty Match matches everything, which is
// how a catch-all rule is written; every field given must match, so a rule with
// two fields is an "and".
type Match struct {
	Title  string            `json:"title,omitempty"`  // regexp
	Body   string            `json:"body,omitempty"`   // regexp
	Labels []string          `json:"labels,omitempty"` // any one of them
	Props  map[string]string `json:"props,omitempty"`  // property → regexp
}

// IsZero reports whether the rule matches everything.
func (m Match) IsZero() bool {
	return m.Title == "" && m.Body == "" && len(m.Labels) == 0 && len(m.Props) == 0
}

// Rule is what to do with an item. Rules are tried in order and the first match
// wins, so the catch-all goes last.
type Rule struct {
	Name string `json:"name,omitempty"`
	When Match  `json:"when"`
	Then string `json:"then"`

	// Column is where the card goes once it exists. Empty leaves the card
	// standing where nothing happens to it, which is what a source that only
	// files things away wants.
	Column string `json:"column,omitempty"`
	// Props are card properties, as Go templates over the item:
	// {"Ссылка": "{{.URL}}"}.
	Props map[string]string `json:"props,omitempty"`
	Agent string            `json:"agent,omitempty"`
}

// SourceEntry is one source. Like a project (internal/acp), it belongs to the
// board it was created on and is offered nowhere else: a phone throwing
// household notifications has no business in the list of a board about code.
type SourceEntry struct {
	Name    string `json:"name"`
	Plugin  string `json:"plugin,omitempty"`
	BoardID string `json:"boardId,omitempty"`
	Global  bool   `json:"global,omitempty"`
	Enabled bool   `json:"enabled"`

	// Property is the card property whose options are columns, and Inbox is
	// where an unmatched item goes.
	Property string `json:"property,omitempty"`
	Inbox    string `json:"inbox,omitempty"`

	// Noisy inverts the default for what matched no rule: a stream of
	// notifications is mostly noise, so there a rule is a subscription and
	// everything else is dropped. For an API source the opposite holds —
	// silently losing an item is what makes an integration impossible to
	// debug — so it goes to the inbox instead.
	Noisy bool `json:"noisy,omitempty"`

	// Update says what a changed item does to the card it already has.
	Update string `json:"update,omitempty"` // comment (default) | ignore

	Config          map[string]string `json:"config,omitempty"`
	IntervalSeconds int               `json:"intervalSeconds,omitempty"`
	SecretRef       string            `json:"secretRef,omitempty"`
	Rules           []Rule            `json:"rules,omitempty"`

	// TokenHash authorizes what is *sent to* this source. It is a hash and not
	// a reference to the secret store, because an inbound token only ever has
	// to be checked: keeping the hash means the registry file cannot leak a
	// credential, and there is nothing to migrate if the store changes. Secrets
	// the app itself has to present — an OAuth token — are the other direction
	// and live in the store under SecretRef.
	TokenHash string `json:"tokenHash,omitempty"`
}

// GenerateToken returns a new ingest token. It is shown once, when it is
// created; only its hash is kept.
func GenerateToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashToken is how a token is stored and compared.
//
// A plain SHA-256 rather than bcrypt: the token is 256 bits from crypto/rand,
// so there is no dictionary to run against it and nothing for a slow hash to
// buy. Password hashing exists because people choose passwords.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CheckToken reports whether the token authorizes this source. A source with no
// token accepts nothing: the token is the whole of the protection on the
// loopback door, so an empty one is a source that is not ready rather than a
// source that is open.
func (s SourceEntry) CheckToken(token string) bool {
	if s.TokenHash == "" || token == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(HashToken(token)), []byte(s.TokenHash)) == 1
}

// Update policies.
const (
	UpdateComment = "comment"
	UpdateIgnore  = "ignore"
)

// OfferedOn reports whether this board may see the source. It mirrors
// ProjectEntry.OfferedOn: an empty board id asks for the whole registry.
func (s SourceEntry) OfferedOn(boardID string) bool {
	if boardID == "" || s.Global {
		return true
	}
	return s.BoardID == boardID
}

// PinnedProperty is the column property this source was told to write to, or
// empty to let the board answer for itself.
func (s SourceEntry) PinnedProperty() string {
	return strings.TrimSpace(s.Property)
}

// InboxOr is the column an unmatched item lands in.
func (s SourceEntry) InboxOr() string {
	if c := strings.TrimSpace(s.Inbox); c != "" {
		return c
	}
	return DefaultInbox
}

// Field is one setting a plugin needs, as its manifest declares it. The form a
// person fills in is built from these, which is the whole reason a manifest
// exists: without it every new source would need its own dialog in the webapp,
// and a plugin somebody else wrote could not have one at all.
//
// The types are a closed set for the same reason the setup wizard's steps are:
// a manifest that could describe anything would be a program, and nothing here
// could promise the form it produced made sense.
type Field struct {
	Key     string   `json:"key"`
	Title   string   `json:"title,omitempty"`
	Type    string   `json:"type,omitempty"` // string | number | bool | select | secret
	Default string   `json:"default,omitempty"`
	Values  []string `json:"values,omitempty"` // for select
}

// FieldTypes lists every accepted field type.
var FieldTypes = []string{"string", "number", "bool", "select", "secret"}

// AuthSpec is what a plugin needs to be given. The app performs the
// authorization — it has the browser, the redirect listener and the keychain —
// and hands the plugin the access token, so this describes the flow rather than
// carrying any of it.
type AuthSpec struct {
	Type             string   `json:"type"` // token | oauth2
	ClientID         string   `json:"clientId,omitempty"`
	AuthorizationURL string   `json:"authorizationUrl,omitempty"`
	TokenURL         string   `json:"tokenUrl,omitempty"`
	Scopes           []string `json:"scopes,omitempty"`

	// ClientSecret is here because some providers refuse a native app without
	// one, not because it is a secret: a desktop app ships it to everybody who
	// installs it. What actually proves the answer came back to this program is
	// PKCE — see internal/oauth.
	ClientSecret string `json:"clientSecret,omitempty"`
}

// Manifest describes a plugin: how to start it, what it needs and what to ask
// for. It is meant to be pasted whole, the way an MCP server is pasted into an
// agent from its README.
type Manifest struct {
	Name            string            `json:"name"`
	Title           string            `json:"title,omitempty"`
	ProtocolVersion int               `json:"protocolVersion,omitempty"`
	Command         string            `json:"command"`
	Args            []string          `json:"args,omitempty"`
	Env             map[string]string `json:"env,omitempty"`
	Auth            *AuthSpec         `json:"auth,omitempty"`
	Fields          []Field           `json:"fields,omitempty"`
}

// Validate normalizes a manifest and refuses what cannot be started or shown.
func (p Manifest) Validate() (Manifest, error) {
	p.Name = strings.TrimSpace(p.Name)
	if p.Name == "" {
		return p, fmt.Errorf("у плагина нет имени")
	}
	p.Command = strings.TrimSpace(p.Command)
	if p.Command == "" {
		return p, fmt.Errorf("плагин %q: не сказано, чем его запускать (command)", p.Name)
	}
	for i, f := range p.Fields {
		if strings.TrimSpace(f.Key) == "" {
			return p, fmt.Errorf("плагин %q: у поля №%d нет ключа", p.Name, i+1)
		}
		if f.Type == "" {
			p.Fields[i].Type = "string"
			continue
		}
		if !contains(FieldTypes, f.Type) {
			return p, fmt.Errorf("плагин %q, поле %q: непонятный тип %q (%s)",
				p.Name, f.Key, f.Type, strings.Join(FieldTypes, ", "))
		}
	}
	return p, nil
}

// Argv is the command to start, ready for the process group.
func (p Manifest) Argv() []string {
	return append([]string{p.Command}, p.Args...)
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// Config is the whole registry, stored as JSON in the app data directory.
type Config struct {
	Sources []SourceEntry `json:"sources"`
	// Plugins are the manifests sources refer to by name. They are registry
	// entries rather than something discovered on disk: starting a program is
	// a deliberate act, and a plugin that appeared because a file did would be
	// one nobody chose.
	Plugins []Manifest `json:"plugins,omitempty"`
}

// Validate normalizes an entry and rejects what cannot work. It returns a
// normalized copy, the way every registry here does.
func (s SourceEntry) Validate() (SourceEntry, error) {
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" {
		return s, fmt.Errorf("у источника нет имени")
	}
	s.Plugin = strings.TrimSpace(s.Plugin)
	s.Property = strings.TrimSpace(s.Property)
	s.Inbox = strings.TrimSpace(s.Inbox)
	s.Update = strings.TrimSpace(s.Update)
	if s.Update != "" && s.Update != UpdateComment && s.Update != UpdateIgnore {
		return s, fmt.Errorf("источник %q: непонятная политика обновления %q (%s или %s)",
			s.Name, s.Update, UpdateComment, UpdateIgnore)
	}
	// A board is required even of a global source. Global says where the entry
	// is *offered* — in every board's dialog rather than one — and the pipeline
	// still has to write the card somewhere: an entry with no board reached
	// CreateCard with an empty id and failed on every item it ever took.
	if s.BoardID == "" {
		return s, fmt.Errorf("источник %q не привязан к доске", s.Name)
	}
	rules := make([]Rule, 0, len(s.Rules))
	for i, r := range s.Rules {
		valid, err := r.Validate()
		if err != nil {
			return s, fmt.Errorf("источник %q, правило №%d: %w", s.Name, i+1, err)
		}
		rules = append(rules, valid)
	}
	s.Rules = rules
	return s, nil
}

// Validate checks a rule and returns a normalized copy. A regexp that does not
// compile is refused here, where somebody is typing it, rather than in the
// pipeline, where nobody is watching.
func (r Rule) Validate() (Rule, error) {
	r.Name = strings.TrimSpace(r.Name)
	r.Then = strings.TrimSpace(r.Then)
	if r.Then == "" {
		r.Then = ActionCard
	}
	if r.Then != ActionCard && r.Then != ActionComment && r.Then != ActionDrop {
		return r, fmt.Errorf("непонятное действие %q (%s)", r.Then, strings.Join(Actions, ", "))
	}
	r.Column = strings.TrimSpace(r.Column)
	for _, expr := range []string{r.When.Title, r.When.Body} {
		if err := checkRegexp(expr); err != nil {
			return r, err
		}
	}
	for prop, expr := range r.When.Props {
		if err := checkRegexp(expr); err != nil {
			return r, fmt.Errorf("свойство %q: %w", prop, err)
		}
	}
	return r, nil
}

func checkRegexp(expr string) error {
	if expr == "" {
		return nil
	}
	if _, err := compileMatch(expr); err != nil {
		return fmt.Errorf("не удалось разобрать выражение %q: %w", expr, err)
	}
	return nil
}

// LoadConfig reads path, creating it empty when absent. An absent file is a
// working state, not an error: a machine with no sources is the normal one.
func LoadConfig(path string) (Config, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		cfg := Config{Sources: []SourceEntry{}}
		return cfg, SaveConfig(path, cfg)
	}
	if err != nil {
		return Config{}, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return Config{}, fmt.Errorf("parse %s: %w", path, err)
	}
	return cfg, nil
}

// SaveConfig writes the registry. The file is 0600 for the same reason the ACP
// one is: entries name secrets even when they do not carry them.
func SaveConfig(path string, cfg Config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, append(out, '\n'), 0o600); err != nil {
		return err
	}
	// WriteFile's mode only applies when it creates the file.
	return os.Chmod(path, 0o600)
}
