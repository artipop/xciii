package model

import "github.com/artipop/xciii/server/mlog"

// LvlFBTelemetry is the level the telemetry service records at: its own, so that
// it is never confused with the server's own lines.
var LvlFBTelemetry = mlog.Level{
	ID:   9000,
	Name: "telemetry",
}
