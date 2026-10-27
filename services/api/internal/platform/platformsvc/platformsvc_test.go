package platformsvc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInviteAndWithdraw(t *testing.T) {
	var got []string
	status := http.StatusNoContent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/identity":
			if r.Header.Get("Metadata-Flavor") != "Google" || r.URL.Query().Get("audience") != "https://platform.example" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			_, _ = w.Write([]byte("tok\n"))
		default:
			got = append(got, r.Method+" "+r.URL.EscapedPath()+" "+r.Header.Get("Authorization"))
			w.WriteHeader(status)
		}
	}))
	defer srv.Close()
	c := &Client{URL: srv.URL, Token: func(context.Context) (string, error) { return "tok", nil }}
	if err := c.Invite(context.Background(), "anna+padel@example.at"); err != nil {
		t.Fatal(err)
	}
	if err := c.Withdraw(context.Background(), "anna+padel@example.at"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"PUT /v1/invitations/anna+padel@example.at/padel Bearer tok",
		"DELETE /v1/invitations/anna+padel@example.at/padel Bearer tok",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("calls:\n%s", strings.Join(got, "\n"))
	}
	status = http.StatusBadGateway
	if err := c.Invite(context.Background(), "a@b.at"); err == nil || !strings.Contains(err.Error(), "502") {
		t.Errorf("a 502 passed: %v", err)
	}

	// The real token comes from the metadata server, for the service's address.
	m := &Client{URL: "https://platform.example", Metadata: srv.URL + "/identity"}
	if tok, err := m.idToken(context.Background()); err != nil || tok != "tok" {
		t.Errorf("idToken: %q %v", tok, err)
	}
	m.URL = "https://other.example"
	if _, err := m.idToken(context.Background()); err == nil {
		t.Error("a refused token passed")
	}
	if err := (&Client{}).Invite(context.Background(), "a@b.at"); err == nil {
		t.Error("no URL passed")
	}
}
