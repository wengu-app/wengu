package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func shortTempDir(t *testing.T) string {
	t.Helper()
	// macOS caps Unix domain socket paths at 104 bytes; $TMPDIR can be longer.
	dir, err := os.MkdirTemp("/tmp", "wengu-mcp-*")
	if err != nil {
		return t.TempDir()
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func testManifest() Manifest {
	return Manifest{
		Version:      "0.1.6",
		Instructions: "Test instructions",
		Tools: []json.RawMessage{
			json.RawMessage(`{"name":"list_decks","title":"List decks"}`),
			json.RawMessage(`{"name":"add_notes","title":"Add notes"}`),
		},
	}
}

func runSession(t *testing.T, input string, cfg Config) (int, []map[string]any) {
	t.Helper()
	var out bytes.Buffer
	code := RunServer(strings.NewReader(input), &out, cfg)
	var msgs []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("invalid json output %q: %v", line, err)
		}
		msgs = append(msgs, m)
	}
	return code, msgs
}

func TestInitializePingToolsListAndNotifications(t *testing.T) {
	longName := strings.Repeat("温", 100)
	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","clientInfo":{"name":"` + longName + `","title":"Test","version":"1.2.3"}}}`,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","id":"p1","method":"ping"}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
		`{"jsonrpc":"2.0","id":3,"method":"unknown/method"}`,
		`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nope"}}`,
		`not json`,
		`[1,2,3]`,
		`{"jsonrpc":"1.0","id":5,"method":"ping"}`,
	}, "\n") + "\n"

	code, msgs := runSession(t, input, Config{
		SocketPath: filepath.Join(t.TempDir(), "missing.sock"),
		Manifest:   testManifest(),
	})
	if code != 0 {
		t.Fatalf("expected exit 0, got %d", code)
	}
	if len(msgs) != 8 {
		t.Fatalf("expected 8 responses (notification skipped), got %d: %#v", len(msgs), msgs)
	}

	initRes := msgs[0]["result"].(map[string]any)
	if initRes["protocolVersion"] != "2025-06-18" {
		t.Fatalf("unexpected protocolVersion: %v", initRes["protocolVersion"])
	}
	serverInfo := initRes["serverInfo"].(map[string]any)
	if serverInfo["name"] != "wengu" || serverInfo["version"] != "0.1.6" {
		t.Fatalf("unexpected serverInfo: %v", serverInfo)
	}

	if msgs[1]["id"] != "p1" {
		t.Fatalf("expected string id p1 preserved, got %#v", msgs[1]["id"])
	}

	toolsRes := msgs[2]["result"].(map[string]any)
	tools := toolsRes["tools"].([]any)
	if len(tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(tools))
	}

	if int(msgs[3]["error"].(map[string]any)["code"].(float64)) != -32601 {
		t.Fatalf("expected -32601, got %v", msgs[3])
	}
	if int(msgs[4]["error"].(map[string]any)["code"].(float64)) != -32602 {
		t.Fatalf("expected -32602, got %v", msgs[4])
	}
	if int(msgs[5]["error"].(map[string]any)["code"].(float64)) != -32700 {
		t.Fatalf("expected -32700, got %v", msgs[5])
	}
	if int(msgs[6]["error"].(map[string]any)["code"].(float64)) != -32600 {
		t.Fatalf("expected -32600, got %v", msgs[6])
	}
	if int(msgs[7]["error"].(map[string]any)["code"].(float64)) != -32600 {
		t.Fatalf("expected -32600, got %v", msgs[7])
	}
}

func TestToolsCallRelayUnix(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket test")
	}
	sockPath := filepath.Join(shortTempDir(t), "agent.sock")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		t.Fatalf("listen unix: %v", err)
	}
	defer ln.Close()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				line, err := bufio.NewReader(c).ReadBytes('\n')
				if err != nil {
					return
				}
				var req agentCallRequest
				if err := json.Unmarshal(line, &req); err != nil {
					return
				}
				switch req.Tool {
				case "list_decks":
					_, _ = c.Write([]byte(`{"id":1,"ok":true,"result":[{"id":1,"name":"Default"}]}` + "\n"))
				case "add_notes":
					// Includes HTML characters to verify they are NOT escaped to \u003c / \u003e.
					_, _ = c.Write([]byte(`{"id":1,"ok":true,"result":{"html":"<b>Mitochondria</b> & ATP","client":"` + req.Client.Name + `"}}` + "\n"))
				}
			}(conn)
		}
	}()

	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"unknown","clientInfo":{"name":"  claude-code  ","version":"1.0"}}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_decks"}}`,
		`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"add_notes","arguments":{"deck":"Bio"}}}`,
	}, "\n") + "\n"

	code, msgs := runSession(t, input, Config{
		SocketPath:  sockPath,
		Manifest:    testManifest(),
		CallTimeout: 5 * time.Second,
	})
	if code != 0 || len(msgs) != 3 {
		t.Fatalf("code=%d msgs=%#v", code, msgs)
	}

	// Unsupported protocol falls back to latest supported.
	if msgs[0]["result"].(map[string]any)["protocolVersion"] != ProtocolVersions[0] {
		t.Fatalf("expected fallback protocol %s, got %v", ProtocolVersions[0], msgs[0]["result"])
	}

	// Array result has NO structuredContent.
	listRes := msgs[1]["result"].(map[string]any)
	if _, has := listRes["structuredContent"]; has {
		t.Fatalf("array result should not have structuredContent: %#v", listRes)
	}

	// Object result HAS structuredContent and preserves raw HTML characters in text.
	addRes := msgs[2]["result"].(map[string]any)
	sc := addRes["structuredContent"].(map[string]any)
	if sc["client"] != "claude-code" {
		t.Fatalf("expected trimmed client name claude-code, got %v", sc["client"])
	}
	content := addRes["content"].([]any)[0].(map[string]any)["text"].(string)
	if !strings.Contains(content, `"<b>Mitochondria</b> & ATP"`) {
		t.Fatalf("expected unescaped HTML in text content, got %s", content)
	}
}

func TestUnreachableAndTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket test")
	}
	missing := filepath.Join(t.TempDir(), "nope.sock")
	r := CallApp(missing, "list_decks", nil, AgentClient{Name: "test"}, time.Second)
	if r.OK || r.Error != NotReachable {
		t.Fatalf("expected NotReachable, got %#v", r)
	}

	// Hanging socket triggers timeout.
	hangSock := filepath.Join(shortTempDir(t), "hang.sock")
	ln, err := net.Listen("unix", hangSock)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		time.Sleep(2 * time.Second)
	}()

	r = CallApp(hangSock, "list_decks", nil, AgentClient{Name: "test"}, 150*time.Millisecond)
	if r.OK || r.Error != "Wengu did not answer in time." {
		t.Fatalf("expected timeout error, got %#v", r)
	}
}

type failWriter struct{}

func (failWriter) Write([]byte) (int, error) { return 0, errors.New("broken pipe") }

func TestBrokenPipeExitsCleanly(t *testing.T) {
	code := RunServer(strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"ping"}`+"\n"), failWriter{}, Config{
		SocketPath: filepath.Join(t.TempDir(), "missing.sock"),
		Manifest:   testManifest(),
	})
	if code != 0 {
		t.Fatalf("expected exit 0 on broken stdout pipe, got %d", code)
	}
}

func TestReadLineLimitAndSplitUTF8(t *testing.T) {
	r := bufio.NewReader(strings.NewReader("温故\nnext\n"))
	line, eof, tooLong, err := readLine(r, 100)
	if err != nil || eof || tooLong || string(line) != "温故" {
		t.Fatalf("unexpected: line=%q eof=%v tooLong=%v err=%v", line, eof, tooLong, err)
	}
	line, eof, tooLong, err = readLine(r, 100)
	if err != nil || eof || tooLong || string(line) != "next" {
		t.Fatalf("unexpected: line=%q eof=%v tooLong=%v err=%v", line, eof, tooLong, err)
	}

	_, _, tooLong, _ = readLine(bufio.NewReader(strings.NewReader(strings.Repeat("a", 11)+"\n")), 10)
	if !tooLong {
		t.Fatalf("expected tooLong=true")
	}
}

func TestResolveUserData(t *testing.T) {
	p, err := ResolveUserData([]string{"--wengu-profile=/tmp/custom"}, func(string) string { return "/tmp/env" })
	if err != nil || !strings.HasSuffix(p, filepath.Join("tmp", "custom")) {
		t.Fatalf("expected arg to win, got %q err=%v", p, err)
	}
	p, err = ResolveUserData(nil, func(k string) string {
		if k == "WENGU_USER_DATA_DIR" {
			return "/tmp/env"
		}
		return ""
	})
	if err != nil || !strings.HasSuffix(p, filepath.Join("tmp", "env")) {
		t.Fatalf("expected env to win, got %q err=%v", p, err)
	}
	p, err = ResolveUserData(nil, func(string) string { return "" })
	if err != nil || filepath.Base(p) != "Wengu" {
		t.Fatalf("expected default Wengu dir, got %q err=%v", p, err)
	}
}
