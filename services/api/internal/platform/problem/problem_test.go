package problem

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestWrite(t *testing.T) {
	rec := httptest.NewRecorder()
	Write(rec, New(404, "not-found", "Not found", "no such note"))
	if rec.Code != 404 || rec.Header().Get("Content-Type") != "application/problem+json" {
		t.Fatalf("got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	var p Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if p.Type != Base+"not-found" || p.Detail != "no such note" || p.Status != 404 {
		t.Errorf("got %+v", p)
	}
}
