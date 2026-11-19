package main

import (
	_ "embed"
	"os"

	"wengu.dev/wengu-mcp"
)

//go:embed tools_gen.json
var manifestJSON []byte

func main() {
	os.Exit(mcp.Main(manifestJSON, os.Args[1:], os.Stdin, os.Stdout))
}
