package acp

import "testing"

func bashInput(command string) any {
	return map[string]any{"command": command}
}

func TestToolPolicyBareNames(t *testing.T) {
	p := ToolPolicy{"Read", "Grep"}

	if !p.Allows("Read", nil) {
		t.Error("a bare name should allow the tool whatever its input")
	}
	if !p.Allows("read", bashInput("irrelevant")) {
		t.Error("tool names should match case-insensitively")
	}
	if p.Allows("Write", nil) {
		t.Error("a tool that is not listed must not be allowed")
	}
}

func TestToolPolicyArgumentPatterns(t *testing.T) {
	p := ToolPolicy{"Bash(git log*)", "Bash(ls)", "Bash(cat *)"}

	allowed := []string{"git log", "git log --oneline -5", "ls", "cat src/main.go"}
	for _, cmd := range allowed {
		if !p.Allows("Bash", bashInput(cmd)) {
			t.Errorf("%q should be allowed", cmd)
		}
	}

	// The dangerous half of Bash stays behind the prompt.
	denied := []string{"rm -rf /", "git push", "ls && rm x", "cat", "lsof"}
	for _, cmd := range denied {
		if p.Allows("Bash", bashInput(cmd)) {
			t.Errorf("%q must not be allowed", cmd)
		}
	}
}

// A narrowed entry cannot approve a call whose argument we cannot see, or the
// pattern would be decoration rather than a restriction.
func TestToolPolicyPatternNeedsTheArgument(t *testing.T) {
	p := ToolPolicy{"Bash(ls *)"}

	if p.Allows("Bash", nil) {
		t.Error("a missing input must not satisfy a narrowed entry")
	}
	if p.Allows("Bash", map[string]any{"notCommand": "ls -la"}) {
		t.Error("an input without the matched field must not satisfy a narrowed entry")
	}
}

// A wide entry alongside a narrow one still wins: the list is a union.
func TestToolPolicyEntriesCombine(t *testing.T) {
	p := ToolPolicy{"Bash(git log*)", "Bash"}

	if !p.Allows("Bash", bashInput("rm -rf /")) {
		t.Error("a bare Bash entry should allow any command")
	}
}

func TestMatchPattern(t *testing.T) {
	cases := []struct {
		pattern, s string
		want       bool
	}{
		{"git log", "git log", true},
		{"git log", "git logs", false},
		{"git *", "git log --oneline", true},
		{"*", "anything at all", true},
		{"a*b", "ab", true},
		{"a*b", "axxxb", true},
		{"a*b", "axxx", false},
		// Commands are not paths: a "/" must not act as a separator.
		{"git log*", "git log -- src/foo/bar.go", true},
	}
	for _, c := range cases {
		if got := matchPattern(c.pattern, c.s); got != c.want {
			t.Errorf("matchPattern(%q, %q) = %v, want %v", c.pattern, c.s, got, c.want)
		}
	}
}
