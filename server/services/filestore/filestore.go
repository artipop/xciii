// Package filestore is where a board's attachments live.
//
// It replaces Mattermost's platform/shared/filestore, which was the last thing
// holding the whole mattermost/server/v8 module in the build — and it came with
// an S3 client, because that package speaks to S3 as well as to a disk. This
// app never asked it to: it configures the local driver and writes under the
// user's own data directory, so what arrived with the dependency was a bucket
// API nothing could reach.
//
// The interface is the part of theirs the board actually calls, and nothing
// else: five methods, all of which the board uses.
package filestore

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// DriverLocal is the only driver there is. The config carries the name because
// upstream's could be "amazons3" too, and a config that asks for one should be
// told plainly rather than quietly given a disk.
const DriverLocal = "local"

// ReadCloseSeeker is what a file is handed out as. Seeking is what serving a
// range request needs, which is how the webapp fetches an image it has already
// half-received.
type ReadCloseSeeker interface {
	io.ReadCloser
	io.Seeker
}

// FileBackend is where attachments are kept. RemoveFile is on it because the
// app's own interface asks for it, though nothing calls it yet — deleting a
// board leaves its files behind today.
type FileBackend interface {
	Reader(path string) (ReadCloseSeeker, error)
	FileExists(path string) (bool, error)
	CopyFile(oldPath, newPath string) error
	MoveFile(oldPath, newPath string) error
	WriteFile(fr io.Reader, path string) (int64, error)
	RemoveFile(path string) error
}

// Settings names the backend to build. It is the shape the board's own config
// hands over, minus everything S3.
type Settings struct {
	DriverName string
	Directory  string
}

// New returns the backend the settings ask for.
func New(settings Settings) (FileBackend, error) {
	if settings.DriverName != DriverLocal {
		return nil, fmt.Errorf("unsupported file driver %q: this build stores files on disk", settings.DriverName)
	}
	if settings.Directory == "" {
		return nil, errors.New("no directory configured for the local file backend")
	}
	return &localBackend{root: settings.Directory}, nil
}

// localBackend keeps files under a directory of its own. Every path it is given
// is relative to that directory and comes from the board — a team id, a board id
// and a generated file name — never from what a person typed.
type localBackend struct {
	root string
}

// resolve joins a path to the root and refuses one that would leave it. Nothing
// upstream of here builds such a path today; the check is here so that a future
// caller passing something through from a request cannot turn this into a way to
// read the disk.
func (b *localBackend) resolve(path string) (string, error) {
	full := filepath.Join(b.root, filepath.FromSlash(path))
	rel, err := filepath.Rel(b.root, full)
	if err != nil || rel == ".." || filepath.IsAbs(rel) ||
		(len(rel) > 2 && rel[:3] == ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is outside the file directory", path)
	}
	return full, nil
}

func (b *localBackend) Reader(path string) (ReadCloseSeeker, error) {
	full, err := b.resolve(path)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, fmt.Errorf("cannot open %q: %w", path, err)
	}
	return f, nil
}

func (b *localBackend) FileExists(path string) (bool, error) {
	full, err := b.resolve(path)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(full)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("cannot stat %q: %w", path, err)
	}
	return true, nil
}

func (b *localBackend) CopyFile(oldPath, newPath string) error {
	src, err := b.Reader(oldPath)
	if err != nil {
		return err
	}
	defer src.Close()

	if _, err := b.WriteFile(src, newPath); err != nil {
		return err
	}
	return nil
}

func (b *localBackend) MoveFile(oldPath, newPath string) error {
	oldFull, err := b.resolve(oldPath)
	if err != nil {
		return err
	}
	newFull, err := b.resolve(newPath)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(newFull), 0750); err != nil {
		return fmt.Errorf("cannot create the directory for %q: %w", newPath, err)
	}
	if err := os.Rename(oldFull, newFull); err != nil {
		return fmt.Errorf("cannot move %q to %q: %w", oldPath, newPath, err)
	}
	return nil
}

// RemoveFile deletes a file, and says nothing about one that was not there:
// removing what is already gone is the outcome the caller asked for.
func (b *localBackend) RemoveFile(path string) error {
	full, err := b.resolve(path)
	if err != nil {
		return err
	}
	if err := os.Remove(full); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("cannot remove %q: %w", path, err)
	}
	return nil
}

func (b *localBackend) WriteFile(fr io.Reader, path string) (int64, error) {
	full, err := b.resolve(path)
	if err != nil {
		return 0, err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0750); err != nil {
		return 0, fmt.Errorf("cannot create the directory for %q: %w", path, err)
	}

	f, err := os.Create(full)
	if err != nil {
		return 0, fmt.Errorf("cannot create %q: %w", path, err)
	}
	defer f.Close()

	written, err := io.Copy(f, fr)
	if err != nil {
		return written, fmt.Errorf("cannot write %q: %w", path, err)
	}
	return written, nil
}
