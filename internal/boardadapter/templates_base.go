//go:build !lifetime

package boardadapter

import "embed"

// editionTemplateFiles is empty in the base edition, and empty is the whole
// point: what the paid edition buys is templates this binary does not contain,
// so there is nothing here to unlock. The importer globs it beside the shipped
// set and finds nothing.
//
// An unused embed.FS is a zero value, not an error — fs.Glob over it returns
// no matches and no error, so no call site needs to know which build it is in.
var editionTemplateFiles embed.FS
