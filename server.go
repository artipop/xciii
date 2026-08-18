package main

import (
	"database/sql"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path"
	"path/filepath"

	"github.com/artipop/xciii/server/server"
	"github.com/artipop/xciii/server/services/config"
	"github.com/artipop/xciii/server/services/notify"
	"github.com/artipop/xciii/server/services/permissions/localpermissions"

	"github.com/artipop/xciii/server/mlog"
)

// getFreePort asks the kernel for a free open port that is ready to use.
func getFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// dataDir returns the writable location for the board database and uploaded
// files — this install's own, so a development build does not open the app's
// boards. See appDataDir.
func dataDir() (string, error) { return appDataDir("server", 0o750) }

// resolveWebPath returns a real on-disk directory the board server can
// serve the webapp from (it templates index.html on read, so it needs files on
// disk, not an fs.FS). Release builds (`-tags frontend`) compile the webapp
// `pack` into the binary; it is extracted once per launch under the data dir.
// Dev builds have nothing embedded and fall back to on-disk pack.
func resolveWebPath(logger mlog.LoggerIFace) string {
	if src, ok := embeddedFrontend(); ok {
		dir, err := extractFrontend(src)
		if err == nil {
			return dir
		}
		logger.Error("failed to extract embedded frontend, falling back to disk", mlog.Err(err))
	}
	return diskWebPath()
}

// extractFrontend writes the embedded pack tree into <dataDir>/web, replacing
// any previous extraction, and returns that directory.
func extractFrontend(src fs.FS) (string, error) {
	data, err := dataDir()
	if err != nil {
		return "", err
	}
	dst := filepath.Join(data, "web")
	if err := os.RemoveAll(dst); err != nil {
		return "", err
	}
	err = fs.WalkDir(src, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		target := filepath.Join(dst, filepath.FromSlash(p))
		if d.IsDir() {
			return os.MkdirAll(target, 0o750)
		}
		in, err := src.Open(p)
		if err != nil {
			return err
		}
		defer in.Close()
		if err := os.MkdirAll(filepath.Dir(target), 0o750); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o640)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, in); err != nil {
			out.Close()
			return err
		}
		return out.Close()
	})
	if err != nil {
		return "", err
	}
	return dst, nil
}

// diskWebPath resolves the webapp `pack` for dev/unpackaged runs: the bundle
// next to the executable, else `webapp/pack` relative to the working dir
// (`wails dev` runs from the module root).
func diskWebPath() string {
	if executable, err := os.Executable(); err == nil {
		executableDir, err := filepath.EvalSymlinks(filepath.Dir(executable))
		if err != nil {
			executableDir = filepath.Dir(executable)
		}
		if next := path.Join(executableDir, "pack"); dirExists(next) {
			return next
		}
	}
	// webapp/pack exists only in a source checkout, and there it is the bundle
	// the dev watcher keeps rebuilding — the same one a release build embeds.
	if cand := filepath.Join("webapp", "pack"); dirExists(cand) {
		return cand
	}
	return "./pack"
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// newServerLogger builds the logger shared by the server and the ACP backend.
func newServerLogger() mlog.LoggerIFace {
	logger, _ := mlog.NewLogger()
	return logger
}

// board is the running board server and the database under it. The handle and
// the prefix travel with it because this application's own tables live in that
// same database (docs/store-plan.md): one file to back up, one connection, and
// a composite write that can be one transaction.
type board struct {
	srv *server.Server
	db  *sql.DB
}

// runServerWithLogger starts the board server in-process (single-user
// mode) on the given port, returning the running server so the caller can
// Shutdown() it. notifyBackends are registered with the server's notification
// service (used by the ACP agent integration to observe card moves).
func runServerWithLogger(logger mlog.LoggerIFace, port int, sessionToken string, notifyBackends []notify.Backend) (board, error) {
	data, err := dataDir()
	if err != nil {
		return board{}, fmt.Errorf("resolving data dir: %w", err)
	}

	cfg := &config.Configuration{
		ServerRoot:              fmt.Sprintf("http://localhost:%d", port),
		Port:                    port,
		DBType:                  "sqlite3",
		DBConfigString:          path.Join(data, "xciii.db"),
		UseSSL:                  false,
		SecureCookie:            true,
		WebPath:                 resolveWebPath(logger),
		FilesDriver:             "local",
		FilesPath:               path.Join(data, "files"),
		SessionExpireTime:       259200000000,
		SessionRefreshTime:      18000,
		LocalOnly:               false,
		EnableLocalMode:         false,
		LocalModeSocketLocation: "",
		AuthMode:                "native",
	}

	singleUser := len(sessionToken) > 0
	db, handle, err := server.NewStore(cfg, singleUser, logger)
	if err != nil {
		return board{}, fmt.Errorf("initializing store: %w", err)
	}

	permissionsService := localpermissions.New(db, logger)

	params := server.Params{
		Cfg:                cfg,
		SingleUserToken:    sessionToken,
		DBStore:            db,
		Logger:             logger,
		PermissionsService: permissionsService,
		NotifyBackends:     notifyBackends,
	}

	srv, err := server.New(params)
	if err != nil {
		return board{}, fmt.Errorf("initializing server: %w", err)
	}

	if err := srv.Start(); err != nil {
		return board{}, fmt.Errorf("starting server: %w", err)
	}
	return board{srv: srv, db: handle}, nil
}
