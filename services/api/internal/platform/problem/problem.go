// Package problem writes RFC 9457 problems, the only shape an error leaves
// the service in (burgstaller-platform standards/api/wire-conventions.md).
package problem

import (
	"encoding/json"
	"net/http"
)

// Base is where every problem type's URI starts; the rest is stable.
const Base = "https://padel.burgstaller.me/problems/"

// Problem is one RFC 9457 problem.
type Problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// Write answers with p.
func Write(w http.ResponseWriter, p Problem) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

// New is a problem of the given kind ("not-found", ...).
func New(status int, kind, title, detail string) Problem {
	return Problem{Type: Base + kind, Title: title, Status: status, Detail: detail}
}
