//go:build !windows

package mcp

import (
	"bufio"
	"errors"
	"net"
	"path/filepath"
	"time"
)

// SocketPath returns the Unix domain socket path for a profile directory.
func SocketPath(userData string) (string, error) {
	return filepath.Join(userData, "agent.sock"), nil
}

func sendAndReceive(socketPath string, payload []byte, timeout time.Duration) ([]byte, error) {
	deadline := time.Now().Add(timeout)
	conn, err := net.DialTimeout("unix", socketPath, timeout)
	if err != nil {
		return nil, errNotReachable
	}
	defer conn.Close()

	if err := conn.SetDeadline(deadline); err != nil {
		return nil, errNotReachable
	}
	if _, err := conn.Write(payload); err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return nil, errTimeout
		}
		return nil, errNotReachable
	}

	line, eof, tooLong, err := readLine(bufio.NewReader(conn), MaxLine)
	if tooLong {
		return nil, errTooLarge
	}
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return nil, errTimeout
		}
		return nil, errNotReachable
	}
	if eof && len(line) == 0 {
		return nil, errNotReachable
	}
	return line, nil
}
