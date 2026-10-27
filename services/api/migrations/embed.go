// Package migrations embeds the SQL files.
//
// This file exists because go:embed patterns cannot traverse upward out
// of the package directory — cmd/api cannot embed ../../migrations.
// So the embed lives next to the files it embeds.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
