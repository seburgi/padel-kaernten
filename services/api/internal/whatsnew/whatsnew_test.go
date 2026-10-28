package whatsnew_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/testdb"
	"github.com/seburgi/padel-kaernten/services/api/internal/whatsnew"
)

// The notes the image ships, read as the API reads them: a broken note
// fails here, so the gate refuses it before it can stop a revision.
func TestLoad_theShippedNotesAllParse(t *testing.T) {
	notes, err := whatsnew.Load(filepath.Join("..", "..", "..", "..", "release_notes"))
	if err != nil {
		t.Fatal(err)
	}
	if len(notes) == 0 {
		t.Fatal("no notes read from release_notes/")
	}
}

func TestLoad_noFolderIsNoNotes(t *testing.T) {
	notes, err := whatsnew.Load(filepath.Join(t.TempDir(), "missing"))
	if err != nil || len(notes) != 0 {
		t.Errorf("Load(missing) = %v, %v; want none and no error", notes, err)
	}
}

func TestLoad_aBrokenNoteNamesItsFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "2026-10-27-broken.md"), []byte("no front matter"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := whatsnew.Load(dir); err == nil || !strings.Contains(err.Error(), "2026-10-27-broken.md") {
		t.Errorf("Load = %v, want an error naming the file", err)
	}
}

func TestParse(t *testing.T) {
	good := "---\ndate: 2026-10-27\narea: courts\ntitle: Ein Titel\nlink: /\n---\nErste\nZeile.\n\n\nZweite.\n"
	note, err := whatsnew.Parse("2026-10-27-ein-titel.md", []byte(good))
	if err != nil {
		t.Fatalf("a good note: %v", err)
	}
	if note.Slug != "2026-10-27-ein-titel" || note.Date != "2026-10-27" || note.Area != "courts" || note.Title != "Ein Titel" || note.Link != "/" {
		t.Errorf("parsed %+v", note)
	}
	if len(note.Paragraphs) != 2 || note.Paragraphs[0] != "Erste Zeile." || note.Paragraphs[1] != "Zweite." {
		t.Errorf("paragraphs = %q", note.Paragraphs)
	}
	for _, tc := range []struct{ name, file, want string }{
		{"Oct-27.md", good, "name it"},
		{"2026-10-27-x.md", "date: 2026-10-27\n", "--- block"},
		{"2026-10-27-x.md", "---\ndate 2026-10-27\n---\nText", "key: value"},
		{"2026-10-27-x.md", "---\ndate: 2026-10-27\narea: courts\n---\nText", "title is missing"},
		{"2026-10-27-x.md", "---\ndate: 27.10.2026\narea: courts\ntitle: T\n---\nText", "YYYY-MM-DD"},
		{"2026-10-28-x.md", "---\ndate: 2026-10-27\narea: courts\ntitle: T\n---\nText", "differ"},
		{"2026-10-27-x.md", "---\ndate: 2026-10-27\narea: weather\ntitle: T\n---\nText", "area must be"},
		{"2026-10-27-x.md", "---\ndate: 2026-10-27\narea: courts\ntitle: T\nlink: https://x\n---\nText", "starting with /"},
		{"2026-10-27-x.md", "---\ndate: 2026-10-27\narea: courts\ntitle: T\n---\n\n", "say what changed"},
	} {
		if _, err := whatsnew.Parse(tc.name, []byte(tc.file)); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("Parse(%s, %q) = %v, want %q", tc.name, tc.file, err, tc.want)
		}
	}
}

func TestService_listsNewestFirstAndRemembersWhoRead(t *testing.T) {
	ctx := t.Context()
	pool := testdb.Pool(t)
	note := func(slug, date string) whatsnew.Note {
		return whatsnew.Note{Slug: slug, Date: date, Area: "app", Title: slug, Paragraphs: []string{"x"}}
	}
	notes := []whatsnew.Note{note("2026-10-27-a", "2026-10-27"), note("2026-10-28-b", "2026-10-28"), note("2026-10-28-c", "2026-10-28")}
	if _, err := whatsnew.NewService(ctx, pool, notes[:2]); err != nil {
		t.Fatal(err)
	}
	s, err := whatsnew.NewService(ctx, pool, notes)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.MarkRead(ctx, "anna@example.at", "6c9b2824-b0cd-4c0b-9052-83d9f457e001", []string{"2026-10-27-a", "not-shipped"}); err != nil {
		t.Fatal(err)
	}
	// The same key again changes nothing and is no error.
	if err := s.MarkRead(ctx, "anna@example.at", "6c9b2824-b0cd-4c0b-9052-83d9f457e001", []string{"2026-10-27-a", "not-shipped"}); err != nil {
		t.Fatalf("replay: %v", err)
	}
	got, err := s.List(ctx, "anna@example.at")
	if err != nil {
		t.Fatal(err)
	}
	order := []string{got[0].Slug, got[1].Slug, got[2].Slug}
	if strings.Join(order, " ") != "2026-10-28-c 2026-10-28-b 2026-10-27-a" {
		t.Errorf("order = %v; newest day first, last arrived first within a day", order)
	}
	if got[0].Read || !got[2].Read {
		t.Errorf("read = %v %v %v", got[0].Read, got[1].Read, got[2].Read)
	}
	other, _ := s.List(ctx, "seb@example.at")
	if other[2].Read {
		t.Error("Anna's reading counted for Seb")
	}
}
