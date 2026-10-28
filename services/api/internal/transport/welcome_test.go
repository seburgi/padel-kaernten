package transport_test

import (
	"strings"
	"testing"
)

func TestWelcome(t *testing.T) {
	a := setup(t)
	if w := a.do(a.as(anna, "GET", "/api/v1/me", "")); w.Code != 200 || !strings.Contains(w.Body.String(), `"welcomed":false`) {
		t.Fatalf("someone new: %d %s", w.Code, w.Body)
	}
	const key = "7c9b2824-b0cd-4c0b-9052-0000000000aa"
	for range 2 {
		if w := a.do(withKey(a.as(anna, "POST", "/api/v1/me/welcomed", ""), key)); w.Code != 200 || !strings.Contains(w.Body.String(), `"welcomed":true`) {
			t.Fatalf("welcomed: %d %s", w.Code, w.Body)
		}
	}
	// A second time, with a new key, is the same.
	if w := a.send(anna, "POST", "/api/v1/me/welcomed", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"welcomed":true`) {
		t.Fatalf("again: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "GET", "/api/v1/me", "")); !strings.Contains(w.Body.String(), `"welcomed":true`) {
		t.Errorf("me after: %s", w.Body)
	}
	// Someone welcomed before ever opening /api/v1/me.
	if w := a.send(seb, "POST", "/api/v1/me/welcomed", ""); w.Code != 200 || !strings.Contains(w.Body.String(), `"canInvite":true`) {
		t.Errorf("first call: %d %s", w.Code, w.Body)
	}
	if w := a.do(a.as(anna, "POST", "/api/v1/me/welcomed", "")); w.Code != 400 {
		t.Errorf("no key: %d %s", w.Code, w.Body)
	}
}
