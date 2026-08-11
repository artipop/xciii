// Package mlog is the board server's logger.
//
// It keeps the name and the shape of Mattermost's mlog, which every file in the
// server logs through, and is a thin layer over the standard library's log/slog
// underneath. Keeping the shape is the point: the alternative was rewriting a
// thousand call sites to say the same thing a different way, and the thing worth
// removing was the dependency, not the sentence `logger.Error("...",
// mlog.Err(err))`.
//
// What did not come across is the machinery around it — log targets configured
// from JSON, file rotation, formatters, a level per target. None of it was
// reachable here: the app builds its logger with no targets at all, so until now
// every line the server logged went nowhere, and the audit service is handed an
// empty config, so its records went nowhere either. A logger that writes to
// stderr is strictly more than this app had.
package mlog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"sync"
	"time"
)

// Field is one key and value on a log line.
type Field = slog.Attr

// Level is a severity. It is a struct rather than a number because the audit
// service defines levels of its own (`auth`, `mod`, `read`) and the telemetry
// service another, and they are named in the output rather than ranked.
type Level struct {
	ID         int
	Name       string
	Stacktrace bool
}

// String makes a Level printable, which is how a custom level reaches the line.
func (l Level) String() string { return l.Name }

// The levels the server logs at. The IDs match Mattermost's, since audit and
// telemetry pick numbers well above them to stay clear.
var (
	LvlPanic = Level{ID: 0, Name: "panic"}
	LvlFatal = Level{ID: 1, Name: "fatal"}
	LvlError = Level{ID: 2, Name: "error"}
	LvlWarn  = Level{ID: 3, Name: "warn"}
	LvlInfo  = Level{ID: 4, Name: "info"}
	LvlDebug = Level{ID: 5, Name: "debug"}
	LvlTrace = Level{ID: 6, Name: "trace"}
)

// slogLevel ranks a level for slog. A level this package does not know — one the
// audit or telemetry service made up — is a record somebody asked to be kept, so
// it is logged at info rather than dropped.
func (l Level) slogLevel() slog.Level {
	switch l.ID {
	case LvlPanic.ID, LvlFatal.ID, LvlError.ID:
		return slog.LevelError
	case LvlWarn.ID:
		return slog.LevelWarn
	case LvlDebug.ID:
		return slog.LevelDebug
	case LvlTrace.ID:
		return slog.LevelDebug - 4
	default:
		return slog.LevelInfo
	}
}

// LoggerIFace is what the server holds when it wants to log. Only what the
// server calls is on it.
type LoggerIFace interface {
	IsLevelEnabled(Level) bool
	Trace(string, ...Field)
	Debug(string, ...Field)
	Info(string, ...Field)
	Warn(string, ...Field)
	Error(string, ...Field)
	Fatal(string, ...Field)
	Log(Level, string, ...Field)
	Flush() error
	StdLogger(Level) *log.Logger
}

// LogCloner is implemented by anything that would rather be logged as a summary
// of itself — a Block logs four of its fields rather than its whole content.
type LogCloner interface {
	LogClone() interface{}
}

// Option configures a logger at construction. Nothing passes one today; the
// audit service takes them because upstream's did.
type Option func(*Logger) error

// Logger writes log lines.
//
// The zero value is usable and writes to stderr, which matters because the
// server's tests build one as `&mlog.Logger{}`.
type Logger struct {
	once  sync.Once
	slog  *slog.Logger
	level slog.Level
}

// NewLogger returns a logger writing to stderr.
func NewLogger(options ...Option) (*Logger, error) {
	logger := &Logger{}
	for _, opt := range options {
		if err := opt(logger); err != nil {
			return nil, err
		}
	}
	return logger, nil
}

// StdWriter sends a logger's output somewhere other than stderr.
func StdWriter(w io.Writer) Option {
	return func(l *Logger) error {
		l.init()
		l.slog = slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: l.level}))
		return nil
	}
}

// Discard builds a logger that writes nothing until something configures it.
// The audit service starts this way: it records something for every request, and
// what it records is meant for a file nobody has asked for — writing it to the
// console instead would bury everything else.
func Discard() Option { return StdWriter(io.Discard) }

// testingT is the part of *testing.T this package needs, named here so that
// nothing outside a test has to import the testing package to build a logger.
type testingT interface {
	Log(args ...interface{})
}

// CreateConsoleTestLogger returns a logger that writes through t.Log, so a
// failing test carries the lines that led to it.
func CreateConsoleTestLogger(t testingT) *Logger {
	logger := &Logger{}
	logger.init()
	logger.slog = slog.New(slog.NewTextHandler(&testWriter{t: t}, &slog.HandlerOptions{Level: slog.LevelDebug}))
	return logger
}

type testWriter struct{ t testingT }

func (w *testWriter) Write(p []byte) (int, error) {
	w.t.Log(string(p))
	return len(p), nil
}

// init gives the zero logger somewhere to write. The level is info because the
// server logs 131 debug lines on ordinary paths, and a desktop app's console is
// not where they belong.
func (l *Logger) init() {
	l.once.Do(func() {
		l.level = slog.LevelInfo
		if l.slog == nil {
			l.slog = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: l.level}))
		}
	})
}

func (l *Logger) write(level Level, msg string, fields ...Field) {
	l.init()
	sl := level.slogLevel()
	if !l.slog.Enabled(context.Background(), sl) {
		return
	}
	args := make([]any, 0, len(fields)+1)
	if level.ID >= LvlTrace.ID+1 {
		// A level of the audit or telemetry service's own: name it, since slog
		// has nowhere else to put it.
		args = append(args, slog.String("level", level.Name))
	}
	for _, f := range fields {
		args = append(args, f)
	}
	l.slog.Log(context.Background(), sl, msg, args...)
}

func (l *Logger) IsLevelEnabled(level Level) bool {
	l.init()
	return l.slog.Enabled(context.Background(), level.slogLevel())
}

func (l *Logger) Trace(msg string, fields ...Field) { l.write(LvlTrace, msg, fields...) }
func (l *Logger) Debug(msg string, fields ...Field) { l.write(LvlDebug, msg, fields...) }
func (l *Logger) Info(msg string, fields ...Field)  { l.write(LvlInfo, msg, fields...) }
func (l *Logger) Warn(msg string, fields ...Field)  { l.write(LvlWarn, msg, fields...) }
func (l *Logger) Error(msg string, fields ...Field) { l.write(LvlError, msg, fields...) }

// Fatal logs and ends the process, which is what the name has always meant here.
func (l *Logger) Fatal(msg string, fields ...Field) {
	l.write(LvlFatal, msg, fields...)
	_ = l.Flush()
	os.Exit(1)
}

func (l *Logger) Log(level Level, msg string, fields ...Field) { l.write(level, msg, fields...) }

// Flush and Shutdown have nothing to do: slog writes as it goes. They stay
// because the server calls them on the way out.
func (l *Logger) Flush() error    { return nil }
func (l *Logger) Shutdown() error { return nil }

// targetCfg is as much of a log target's JSON as this build can honour.
type targetCfg struct {
	Type    string `json:"type"`
	Options struct {
		Out string `json:"out"`
	} `json:"options"`
	Levels []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"levels"`
}

// Configure reads the log targets a caller asks for. This build can write to the
// console and nowhere else — no files, no rotation, no target per level — so a
// console target is honoured down to the most verbose level it names, and
// anything else is refused by name rather than quietly dropped.
func (l *Logger) Configure(cfgFile string, cfgEscaped string, _ interface{}) error {
	cfg := cfgEscaped
	if cfgFile != "" {
		data, err := os.ReadFile(cfgFile)
		if err != nil {
			return fmt.Errorf("cannot read the logging config %q: %w", cfgFile, err)
		}
		cfg = string(data)
	}
	if cfg == "" {
		return nil
	}

	targets := map[string]targetCfg{}
	if err := json.Unmarshal([]byte(cfg), &targets); err != nil {
		return fmt.Errorf("cannot read the logging config: %w", err)
	}

	out := io.Writer(os.Stderr)
	level := slog.LevelError
	for name, target := range targets {
		if target.Type != "console" {
			return fmt.Errorf("this build logs to the console only; target %q asks for %q", name, target.Type)
		}
		if target.Options.Out == "stdout" {
			out = os.Stdout
		}
		for _, want := range target.Levels {
			if sl := (Level{ID: want.ID}).slogLevel(); sl < level {
				level = sl
			}
		}
	}

	l.init()
	l.level = level
	l.slog = slog.New(slog.NewTextHandler(out, &slog.HandlerOptions{Level: level}))
	return nil
}

// StdLogger adapts this logger for a library that wants the standard one.
func (l *Logger) StdLogger(level Level) *log.Logger {
	l.init()
	return slog.NewLogLogger(l.slog.Handler(), level.slogLevel())
}

// The fields. Their signatures are the ones the server already calls with,
// generics included, so that no call site had to change.

func String[T ~string | ~[]byte](key string, val T) Field {
	return slog.String(key, string(val))
}

func Int[T ~int | ~int8 | ~int16 | ~int32 | ~int64](key string, val T) Field {
	return slog.Int64(key, int64(val))
}

func Uint[T ~uint | ~uint8 | ~uint16 | ~uint32 | ~uint64 | ~uintptr](key string, val T) Field {
	return slog.Uint64(key, uint64(val))
}

func Bool[T ~bool](key string, val T) Field {
	return slog.Bool(key, bool(val))
}

func Float64(key string, val float64) Field { return slog.Float64(key, val) }

func Time(key string, val time.Time) Field { return slog.Time(key, val) }

func Duration(key string, val time.Duration) Field { return slog.Duration(key, val) }

func Stringer(key string, val fmt.Stringer) Field { return slog.Any(key, val) }

func Array[S ~[]E, E any](key string, val S) Field { return slog.Any(key, val) }

func Map[M ~map[K]V, K comparable, V any](key string, val M) Field { return slog.Any(key, val) }

func Any(key string, val interface{}) Field { return slog.Any(key, val) }

// Err is the one field with a fixed key, because an error is always the same
// thing on a line.
func Err(err error) Field {
	if err == nil {
		return slog.String("error", "")
	}
	return slog.String("error", err.Error())
}
