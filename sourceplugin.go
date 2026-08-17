package main

import (
	"fmt"
	"os"

	"github.com/artipop/xciii/internal/sources/imapsource"
	"github.com/artipop/xciii/sources/sdk"
)

// maybeRunSourcePlugin handles `<binary> sourceplugin <name>`: the same
// executable doubles as a source plugin a manifest starts with `$self`
// (internal/sources/config.go), exactly as maybeRunMCP does for the MCP
// servers this app carries. It must run before the board server and Wails
// are touched, and it never returns — stdout belongs to the sources/protocol
// stream from here on.
func maybeRunSourcePlugin(args []string) {
	if len(args) == 0 || args[0] != "sourceplugin" {
		return
	}
	if len(args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: xciii sourceplugin %s\n", imapsource.PluginName)
		os.Exit(2)
	}
	switch args[1] {
	case imapsource.PluginName:
		sdk.Serve(imapsource.Plugin())
	default:
		fmt.Fprintf(os.Stderr, "неизвестный плагин источника %q (есть %q)\n", args[1], imapsource.PluginName)
		os.Exit(2)
	}
	os.Exit(0)
}
