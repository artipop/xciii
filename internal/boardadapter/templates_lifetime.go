//go:build lifetime

package boardadapter

import "embed"

// editionTemplateFiles is what the lifetime edition ships on top of the boards
// every build has (internal/edition). They live in their own directory rather
// than beside the others so that `templates/*.jsonl` — the pattern the base
// build embeds — cannot pick them up by accident: an extra template that
// shipped in both editions is a paid feature given away by a filename.
//
// A slug still has to be unique across both sets, since the slug is the file's
// own name and it is what the importer keys an installed template by.
// TestNoTwoTemplatesShareASlug is the guard.
//
//go:embed templates/lifetime/*.jsonl
var editionTemplateFiles embed.FS
