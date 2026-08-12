// Package mocks is a testify mock of the file backend, written by hand rather
// than generated: the interface is five methods and lives in this repository, so
// a generator would be a tool to install for the sake of sixty lines.
package mocks

import (
	"io"

	"github.com/stretchr/testify/mock"

	"github.com/artipop/xciii/server/services/filestore"
)

// FileBackend mocks filestore.FileBackend.
type FileBackend struct {
	mock.Mock
}

// ReadCloseSeeker mocks the file a backend hands out. The board's tests only
// ever pass one around as the thing Reader returned, so nothing is asserted on
// it and every method answers with the zero value.
type ReadCloseSeeker struct {
	mock.Mock
}

func (m *ReadCloseSeeker) Read(p []byte) (int, error) {
	ret := m.Called(p)
	n, _ := ret.Get(0).(int)
	err, _ := ret.Get(1).(error)
	return n, err
}

func (m *ReadCloseSeeker) Close() error {
	ret := m.Called()
	err, _ := ret.Get(0).(error)
	return err
}

func (m *ReadCloseSeeker) Seek(offset int64, whence int) (int64, error) {
	ret := m.Called(offset, whence)
	pos, _ := ret.Get(0).(int64)
	err, _ := ret.Get(1).(error)
	return pos, err
}

func (m *FileBackend) Reader(path string) (filestore.ReadCloseSeeker, error) {
	ret := m.Called(path)

	var reader filestore.ReadCloseSeeker
	if fn, ok := ret.Get(0).(func(string) filestore.ReadCloseSeeker); ok {
		reader = fn(path)
	} else if ret.Get(0) != nil {
		reader = ret.Get(0).(filestore.ReadCloseSeeker)
	}

	return reader, errorArg(ret, 1, path)
}

func (m *FileBackend) FileExists(path string) (bool, error) {
	ret := m.Called(path)

	var exists bool
	if fn, ok := ret.Get(0).(func(string) bool); ok {
		exists = fn(path)
	} else {
		exists, _ = ret.Get(0).(bool)
	}

	return exists, errorArg(ret, 1, path)
}

func (m *FileBackend) CopyFile(oldPath, newPath string) error {
	ret := m.Called(oldPath, newPath)

	if fn, ok := ret.Get(0).(func(string, string) error); ok {
		return fn(oldPath, newPath)
	}
	err, _ := ret.Get(0).(error)
	return err
}

func (m *FileBackend) MoveFile(oldPath, newPath string) error {
	ret := m.Called(oldPath, newPath)

	if fn, ok := ret.Get(0).(func(string, string) error); ok {
		return fn(oldPath, newPath)
	}
	err, _ := ret.Get(0).(error)
	return err
}

func (m *FileBackend) RemoveFile(path string) error {
	ret := m.Called(path)

	if fn, ok := ret.Get(0).(func(string) error); ok {
		return fn(path)
	}
	err, _ := ret.Get(0).(error)
	return err
}

func (m *FileBackend) WriteFile(fr io.Reader, path string) (int64, error) {
	ret := m.Called(fr, path)

	var written int64
	if fn, ok := ret.Get(0).(func(io.Reader, string) int64); ok {
		written = fn(fr, path)
	} else {
		written, _ = ret.Get(0).(int64)
	}

	var err error
	if fn, ok := ret.Get(1).(func(io.Reader, string) error); ok {
		err = fn(fr, path)
	} else {
		err, _ = ret.Get(1).(error)
	}

	return written, err
}

// errorArg reads the error return, which a test may give either as a value or
// as a function of the path — mockery's generated mocks accept both, and the
// board's tests use both.
func errorArg(ret mock.Arguments, index int, path string) error {
	if fn, ok := ret.Get(index).(func(string) error); ok {
		return fn(path)
	}
	err, _ := ret.Get(index).(error)
	return err
}
