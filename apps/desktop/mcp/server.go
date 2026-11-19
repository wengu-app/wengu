// Package mcp implements the standalone Wengu (温故) MCP stdio proxy.
//
// It holds no data. `tools/list` is answered from the embedded tool manifest generated from
// apps/web/src/agent/tools.ts; each `tools/call` is relayed over the profile's local agent
// socket (Unix domain socket on macOS/Linux, named pipe on Windows) to the running Wengu
// desktop app. The protocol is JSON-RPC 2.0, one message per line on stdin/stdout.
// Nothing but protocol messages may be written to stdout.
package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ProtocolVersions = []string{"2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"}

const (
	NotReachable       = "Wengu (温故) is not reachable. Ask the user to open the Wengu desktop app and turn on Settings → Agents → “Allow local agents” (设置 → Agent → 允许本机 agent 访问), then try again."
	MaxLine            = 16 * 1024 * 1024
	DefaultCallTimeout = 120 * time.Second
)

var (
	errNotReachable = errors.New(NotReachable)
	errTimeout      = errors.New("Wengu did not answer in time.")
	errTooLarge     = errors.New("Wengu reply exceeds the size limit.")
)

// Manifest holds the build-time metadata embedded from apps/web/src/agent/tools.ts and apps/desktop/package.json.
type Manifest struct {
	Version      string            `json:"version"`
	Instructions string            `json:"instructions"`
	Tools        []json.RawMessage `json:"tools"`
}

// AgentClient identifies the MCP client from initialize.params.clientInfo.
type AgentClient struct {
	Name    string `json:"name"`
	Title   string `json:"title,omitempty"`
	Version string `json:"version,omitempty"`
}

type agentCallRequest struct {
	ID     int             `json:"id"`
	Tool   string          `json:"tool"`
	Args   json.RawMessage `json:"args"`
	Client AgentClient     `json:"client"`
}

// AgentReply is the response returned by the desktop app over the local socket.
type AgentReply struct {
	ID     int             `json:"id"`
	OK     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

// Config configures one MCP stdio server session.
type Config struct {
	SocketPath  string
	Manifest    Manifest
	CallTimeout time.Duration
}

// ResolveUserData determines the Wengu profile directory from CLI flags, WENGU_USER_DATA_DIR, or the OS default.
func ResolveUserData(args []string, getenv func(string) string) (string, error) {
	var profileDir string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if v, ok := strings.CutPrefix(a, "--wengu-profile="); ok {
			profileDir = v
			break
		}
		if a == "--wengu-profile" && i+1 < len(args) {
			profileDir = args[i+1]
			break
		}
	}
	if profileDir == "" && getenv != nil {
		profileDir = getenv("WENGU_USER_DATA_DIR")
	}
	if profileDir != "" {
		return filepath.Abs(profileDir)
	}
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfgDir, "Wengu"), nil
}

// Main is the CLI entry point for cmd/wengu-mcp.
func Main(manifestJSON []byte, args []string, stdin io.Reader, stdout io.Writer) int {
	var manifest Manifest
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		return 1
	}
	userData, err := ResolveUserData(args, os.Getenv)
	if err != nil {
		return 1
	}
	socketPath, err := SocketPath(userData)
	if err != nil {
		return 1
	}
	return RunServer(stdin, stdout, Config{
		SocketPath:  socketPath,
		Manifest:    manifest,
		CallTimeout: DefaultCallTimeout,
	})
}

// CallApp sends one tool call over the local socket and waits for the desktop app's reply.
func CallApp(socketPath, tool string, args json.RawMessage, client AgentClient, timeout time.Duration) AgentReply {
	if timeout <= 0 {
		timeout = DefaultCallTimeout
	}
	trimmedArgs := bytes.TrimSpace(args)
	if len(trimmedArgs) == 0 || bytes.Equal(trimmedArgs, []byte("null")) {
		trimmedArgs = json.RawMessage("{}")
	}
	payload, err := marshalJSON(agentCallRequest{
		ID:     1,
		Tool:   tool,
		Args:   trimmedArgs,
		Client: client,
	}, false)
	if err != nil {
		return AgentReply{ID: 1, OK: false, Error: err.Error()}
	}
	payload = append(payload, '\n')

	line, err := sendAndReceive(socketPath, payload, timeout)
	if err != nil {
		return AgentReply{ID: 1, OK: false, Error: err.Error()}
	}
	var reply AgentReply
	if err := json.Unmarshal(bytes.TrimSpace(line), &reply); err != nil {
		return AgentReply{ID: 1, OK: false, Error: "Wengu sent an invalid reply."}
	}
	return reply
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  *string         `json:"method"`
	Params  json.RawMessage `json:"params"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type rpcResultResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result"`
}

type rpcErrorResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Error   rpcError        `json:"error"`
}

// RunServer serves MCP JSON-RPC 2.0 messages line by line from stdin to stdout.
func RunServer(stdin io.Reader, stdout io.Writer, cfg Config) int {
	if cfg.CallTimeout <= 0 {
		cfg.CallTimeout = DefaultCallTimeout
	}
	toolNames := make(map[string]bool, len(cfg.Manifest.Tools))
	for _, raw := range cfg.Manifest.Tools {
		var meta struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(raw, &meta); err == nil && meta.Name != "" {
			toolNames[meta.Name] = true
		}
	}

	client := AgentClient{Name: "unknown"}
	writer := bufio.NewWriter(stdout)

	writeMsg := func(msg any) bool {
		b, err := marshalJSON(msg, false)
		if err != nil {
			return false
		}
		b = append(b, '\n')
		if _, err := writer.Write(b); err != nil {
			return false
		}
		return writer.Flush() == nil
	}
	sendResult := func(id json.RawMessage, value any) bool {
		return writeMsg(rpcResultResponse{JSONRPC: "2.0", ID: normalizeID(id), Result: value})
	}
	sendError := func(id json.RawMessage, code int, message string) bool {
		return writeMsg(rpcErrorResponse{JSONRPC: "2.0", ID: normalizeID(id), Error: rpcError{Code: code, Message: message}})
	}

	reader := bufio.NewReader(stdin)
	for {
		rawLine, eof, tooLong, err := readLine(reader, MaxLine)
		if tooLong {
			return 1
		}
		if err != nil {
			return 0
		}
		trimmed := bytes.TrimSpace(rawLine)
		if len(trimmed) == 0 {
			if eof {
				return 0
			}
			continue
		}

		// Must be a JSON object.
		var msg rpcMessage
		if trimmed[0] != '{' {
			if !json.Valid(trimmed) {
				if !sendError(nil, -32700, "Parse error") {
					return 0
				}
			} else if !sendError(nil, -32600, "Invalid request") {
				return 0
			}
			if eof {
				return 0
			}
			continue
		}
		if err := json.Unmarshal(trimmed, &msg); err != nil {
			if !sendError(nil, -32700, "Parse error") {
				return 0
			}
			if eof {
				return 0
			}
			continue
		}
		if msg.JSONRPC != "2.0" || msg.Method == nil {
			if !sendError(msg.ID, -32600, "Invalid request") {
				return 0
			}
			if eof {
				return 0
			}
			continue
		}

		isRequest := len(bytes.TrimSpace(msg.ID)) > 0 && !bytes.Equal(bytes.TrimSpace(msg.ID), []byte("null"))
		method := *msg.Method

		var params map[string]json.RawMessage
		if len(bytes.TrimSpace(msg.Params)) > 0 {
			_ = json.Unmarshal(msg.Params, &params)
		}

		ok := true
		switch method {
		case "initialize":
			if rawInfo, exists := params["clientInfo"]; exists {
				var info struct {
					Name    *string `json:"name"`
					Title   *string `json:"title"`
					Version *string `json:"version"`
				}
				if err := json.Unmarshal(rawInfo, &info); err == nil && info.Name != nil {
					if name := strings.TrimSpace(*info.Name); name != "" {
						c := AgentClient{Name: trimRunes(name, 80)}
						if info.Title != nil {
							c.Title = trimRunes(*info.Title, 80)
						}
						if info.Version != nil {
							c.Version = trimRunes(*info.Version, 40)
						}
						client = c
					}
				}
			}
			proto := ProtocolVersions[0]
			if rawProto, exists := params["protocolVersion"]; exists {
				var asked string
				if err := json.Unmarshal(rawProto, &asked); err == nil {
					for _, supported := range ProtocolVersions {
						if asked == supported {
							proto = asked
							break
						}
					}
				}
			}
			ok = sendResult(msg.ID, map[string]any{
				"protocolVersion": proto,
				"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
				"serverInfo": map[string]any{
					"name":    "wengu",
					"title":   "温故 Wengu",
					"version": cfg.Manifest.Version,
				},
				"instructions": cfg.Manifest.Instructions,
			})

		case "ping":
			ok = sendResult(msg.ID, map[string]any{})

		case "tools/list":
			tools := cfg.Manifest.Tools
			if tools == nil {
				tools = []json.RawMessage{}
			}
			ok = sendResult(msg.ID, map[string]any{"tools": tools})

		case "tools/call":
			var name string
			nameOK := false
			if rawName, exists := params["name"]; exists {
				if err := json.Unmarshal(rawName, &name); err == nil {
					nameOK = true
				}
			}
			if !nameOK || !toolNames[name] {
				bad := "undefined"
				if nameOK {
					bad = name
				} else if rawName, exists := params["name"]; exists {
					bad = string(bytes.TrimSpace(rawName))
				}
				ok = sendError(msg.ID, -32602, fmt.Sprintf("Unknown tool: %s", bad))
				break
			}
			reply := CallApp(cfg.SocketPath, name, params["arguments"], client, cfg.CallTimeout)
			if reply.OK {
				val := bytes.TrimSpace(reply.Result)
				if len(val) == 0 {
					val = []byte("null")
				}
				pretty, err := formatPrettyJSON(val)
				if err != nil {
					pretty = string(val)
				}
				res := map[string]any{
					"content": []map[string]string{{"type": "text", "text": pretty}},
				}
				if isJSONObject(val) {
					res["structuredContent"] = json.RawMessage(val)
				}
				ok = sendResult(msg.ID, res)
			} else {
				ok = sendResult(msg.ID, map[string]any{
					"content": []map[string]string{{"type": "text", "text": reply.Error}},
					"isError": true,
				})
			}

		default:
			if isRequest {
				ok = sendError(msg.ID, -32601, fmt.Sprintf("Method not found: %s", method))
			}
		}

		if !ok || eof {
			return 0
		}
	}
}

// readLine reads one '\n'-delimited line without exceeding maxBytes.
// Returns tooLong=true as soon as more than maxBytes have been buffered without a newline.
func readLine(r *bufio.Reader, maxBytes int) (line []byte, eof bool, tooLong bool, err error) {
	var buf []byte
	for {
		frag, readErr := r.ReadSlice('\n')
		if len(frag) > 0 {
			// Count bytes excluding the trailing '\n', matching agentBridge.ts lineReader.
			part := frag
			hasNL := part[len(part)-1] == '\n'
			if hasNL {
				part = part[:len(part)-1]
			}
			if len(buf)+len(part) > maxBytes {
				return nil, false, true, nil
			}
			buf = append(buf, part...)
			if hasNL {
				return buf, false, false, nil
			}
		}
		if readErr == nil {
			continue
		}
		if errors.Is(readErr, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(readErr, io.EOF) {
			return buf, true, false, nil
		}
		return nil, false, false, readErr
	}
}

func normalizeID(id json.RawMessage) json.RawMessage {
	trimmed := bytes.TrimSpace(id)
	if len(trimmed) == 0 {
		return json.RawMessage("null")
	}
	return trimmed
}

func trimRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}

func isJSONObject(raw []byte) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) > 0 && trimmed[0] == '{'
}

func marshalJSON(v any, indent bool) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if indent {
		enc.SetIndent("", "  ")
	}
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	out := buf.Bytes()
	if len(out) > 0 && out[len(out)-1] == '\n' {
		out = out[:len(out)-1]
	}
	return out, nil
}

func formatPrettyJSON(raw []byte) (string, error) {
	var v any
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&v); err != nil {
		return "", err
	}
	b, err := marshalJSON(v, true)
	if err != nil {
		return "", err
	}
	return string(b), nil
}
