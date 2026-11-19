//go:build windows

package mcp

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel32          = syscall.NewLazyDLL("kernel32.dll")
	procWaitNamedPipe = kernel32.NewProc("WaitNamedPipeW")
	procCancelIoEx    = kernel32.NewProc("CancelIoEx")
)

const (
	errPipeBusy syscall.Errno = 231
)

// SocketPath returns the Windows named pipe path for a profile directory, matching agentBridge.ts.
func SocketPath(userData string) (string, error) {
	abs, err := filepath.Abs(userData)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(abs))
	return `\\.\pipe\wengu-agent-` + hex.EncodeToString(sum[:])[:16], nil
}

func openNamedPipe(pipePath string, deadline time.Time) (*os.File, error) {
	p, err := syscall.UTF16PtrFromString(pipePath)
	if err != nil {
		return nil, errNotReachable
	}
	for {
		h, err := syscall.CreateFile(
			p,
			syscall.GENERIC_READ|syscall.GENERIC_WRITE,
			0,
			nil,
			syscall.OPEN_EXISTING,
			0,
			0,
		)
		if err == nil {
			return os.NewFile(uintptr(h), pipePath), nil
		}
		if !errors.Is(err, errPipeBusy) {
			return nil, errNotReachable
		}
		rem := time.Until(deadline)
		if rem <= 0 {
			return nil, errTimeout
		}
		waitMs := uint32(min(rem.Milliseconds(), 500))
		if waitMs == 0 {
			waitMs = 1
		}
		r1, _, _ := procWaitNamedPipe.Call(uintptr(unsafe.Pointer(p)), uintptr(waitMs))
		if r1 == 0 {
			if time.Now().After(deadline) {
				return nil, errTimeout
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

func sendAndReceive(socketPath string, payload []byte, timeout time.Duration) ([]byte, error) {
	deadline := time.Now().Add(timeout)
	f, err := openNamedPipe(socketPath, deadline)
	if err != nil {
		return nil, err
	}

	var closeOnce sync.Once
	closePipe := func() {
		closeOnce.Do(func() {
			_, _, _ = procCancelIoEx.Call(f.Fd(), 0)
			_ = f.Close()
		})
	}
	defer closePipe()

	timedOut := make(chan struct{}, 1)
	timer := time.AfterFunc(time.Until(deadline), func() {
		select {
		case timedOut <- struct{}{}:
		default:
		}
		closePipe()
	})
	defer timer.Stop()

	if _, err := f.Write(payload); err != nil {
		select {
		case <-timedOut:
			return nil, errTimeout
		default:
			return nil, errNotReachable
		}
	}

	line, eof, tooLong, err := readLine(bufio.NewReader(f), MaxLine)
	if tooLong {
		return nil, errTooLarge
	}
	if err != nil {
		select {
		case <-timedOut:
			return nil, errTimeout
		default:
			return nil, errNotReachable
		}
	}
	if eof && len(line) == 0 {
		select {
		case <-timedOut:
			return nil, errTimeout
		default:
			return nil, errNotReachable
		}
	}
	return line, nil
}
