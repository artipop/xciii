package filestore

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func newBackend(t *testing.T) (FileBackend, string) {
	t.Helper()
	dir := t.TempDir()
	backend, err := New(Settings{DriverName: DriverLocal, Directory: dir})
	require.NoError(t, err)
	return backend, dir
}

func write(t *testing.T, b FileBackend, path, content string) {
	t.Helper()
	written, err := b.WriteFile(strings.NewReader(content), path)
	require.NoError(t, err)
	require.Equal(t, int64(len(content)), written)
}

func read(t *testing.T, b FileBackend, path string) string {
	t.Helper()
	r, err := b.Reader(path)
	require.NoError(t, err)
	defer r.Close()
	data, err := io.ReadAll(r)
	require.NoError(t, err)
	return string(data)
}

// An attachment is written under a path the board makes up — team, board, file
// name — and the directories in it do not exist yet.
func TestAFileIsWrittenUnderAPathThatDoesNotExistYet(t *testing.T) {
	backend, dir := newBackend(t)

	write(t, backend, "boards/20260811/attachment.png", "picture")

	require.Equal(t, "picture", read(t, backend, "boards/20260811/attachment.png"))
	_, err := os.Stat(filepath.Join(dir, "boards", "20260811", "attachment.png"))
	require.NoError(t, err, "the file should be on the disk where the path says")
}

// Serving a range request seeks, which is why a file is handed out as more than
// a reader.
func TestAFileCanBeSeeked(t *testing.T) {
	backend, _ := newBackend(t)
	write(t, backend, "f.txt", "0123456789")

	r, err := backend.Reader("f.txt")
	require.NoError(t, err)
	defer r.Close()

	_, err = r.Seek(4, io.SeekStart)
	require.NoError(t, err)
	rest, err := io.ReadAll(r)
	require.NoError(t, err)
	require.Equal(t, "456789", string(rest))
}

// A file the board has no record of is not an error, it is a "no" — the board
// asks before it serves.
func TestAskingForAFileThatIsNotThere(t *testing.T) {
	backend, _ := newBackend(t)

	exists, err := backend.FileExists("nothing/here.png")
	require.NoError(t, err)
	require.False(t, exists)

	_, err = backend.Reader("nothing/here.png")
	require.Error(t, err)
}

// Moving is how a file uploaded before boards had folders is brought to where
// it is looked for now; copying is what duplicating a board does with them.
func TestMovingAndCopying(t *testing.T) {
	backend, _ := newBackend(t)
	write(t, backend, "old.txt", "content")

	require.NoError(t, backend.MoveFile("old.txt", "boards/new.txt"))
	require.Equal(t, "content", read(t, backend, "boards/new.txt"))
	exists, err := backend.FileExists("old.txt")
	require.NoError(t, err)
	require.False(t, exists, "a moved file should not still be at the old path")

	require.NoError(t, backend.CopyFile("boards/new.txt", "boards/copy.txt"))
	require.Equal(t, "content", read(t, backend, "boards/copy.txt"))
	require.Equal(t, "content", read(t, backend, "boards/new.txt"), "copying should leave the original")
}

// Removing what is already gone is the outcome the caller asked for.
func TestRemovingIsIdempotent(t *testing.T) {
	backend, _ := newBackend(t)
	write(t, backend, "f.txt", "x")

	require.NoError(t, backend.RemoveFile("f.txt"))
	require.NoError(t, backend.RemoveFile("f.txt"))

	exists, err := backend.FileExists("f.txt")
	require.NoError(t, err)
	require.False(t, exists)
}

// Nothing builds such a path today — the board makes them out of ids — but this
// backend is handed paths, and one that climbs out of its directory has to be
// refused rather than followed to the user's home.
func TestAPathCannotLeaveTheFileDirectory(t *testing.T) {
	backend, dir := newBackend(t)
	require.NoError(t, os.WriteFile(filepath.Join(filepath.Dir(dir), "secret.txt"), []byte("secret"), 0600))

	for _, path := range []string{
		"../secret.txt",
		"boards/../../secret.txt",
	} {
		t.Run(path, func(t *testing.T) {
			_, err := backend.Reader(path)
			require.Error(t, err)

			_, err = backend.WriteFile(strings.NewReader("x"), path)
			require.Error(t, err)
		})
	}

	// An absolute path needs no refusing: joining it to the directory puts it
	// under the directory, which is the answer either way.
	t.Run("an absolute path is taken as one inside", func(t *testing.T) {
		write(t, backend, "/etc/passwd", "ours")
		require.Equal(t, "ours", read(t, backend, "etc/passwd"))
		require.FileExists(t, filepath.Join(dir, "etc", "passwd"))
	})
}

// The config still carries upstream's driver name, and a build that cannot do
// what it asks for should say so rather than quietly write to a disk nobody
// meant.
func TestADriverThisBuildDoesNotHave(t *testing.T) {
	_, err := New(Settings{DriverName: "amazons3", Directory: t.TempDir()})
	require.ErrorContains(t, err, "amazons3")
}
