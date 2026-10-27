// Command sites asks every booking site in venues.json once and prints the
// snapshot as JSON, for adding or fixing a venue (docs/design/booking-sites.md):
//
//	go run ./cmd/sites > /tmp/snapshot.json
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/seburgi/padel-kaernten/services/api/internal/slots/sites"
)

func main() {
	c := &sites.Client{HTTP: &http.Client{Timeout: 25 * time.Second}}
	snap, failed, err := c.Take(context.Background())
	for _, f := range failed {
		fmt.Fprintln(os.Stderr, "failed:", f)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(snap)
}
