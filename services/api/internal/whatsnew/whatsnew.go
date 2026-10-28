// Package whatsnew is the What's new page (docs/design/whats-new.md;
// burgstaller-platform standards/workflow/release-notes.md): one file per
// change in release_notes/ at the repository root, shipped in the image at
// /release_notes. A note looks like this:
//
//	---
//	date: 2026-10-28
//	area: courts
//	title: Neu: was sich geändert hat
//	link: /whats-new
//	---
//	Ein bis drei kurze Absätze für die Leute, die Padel benutzen.
//
//	Eine Leerzeile beginnt einen neuen Absatz.
//
// The files are the notes; the database adds what files cannot know: when
// a note arrived, so a day's notes list in that order, and who read which.
package whatsnew

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/seburgi/padel-kaernten/services/api/internal/platform/idempotency"
)

// Areas are the areas a note may name, kept in CLAUDE.md too.
var Areas = []string{"courts", "invites", "app"}

// Note is one note file, and whether the person asking has read it.
type Note struct {
	Slug       string
	Date       string // YYYY-MM-DD
	Area       string
	Title      string
	Paragraphs []string
	Link       string // "" for none
	Read       bool
}

var (
	noteSlug       = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`)
	noteFile       = regexp.MustCompile(`(?s)\A---\s*\n(.*?)\n---\s*\n(.*)\z`)
	paragraphBreak = regexp.MustCompile(`\n\s*\n`)
)

// Parse reads one note, or says what is wrong with it, naming the file.
func Parse(name string, data []byte) (Note, error) {
	bad := func(format string, args ...any) error {
		return fmt.Errorf("%s: %s", name, fmt.Sprintf(format, args...))
	}
	slug := strings.TrimSuffix(name, ".md")
	if !noteSlug.MatchString(slug) {
		return Note{}, bad("name it YYYY-MM-DD-some-words.md (lowercase, dashes)")
	}
	match := noteFile.FindStringSubmatch(strings.ReplaceAll(string(data), "\r\n", "\n"))
	if match == nil {
		return Note{}, bad("starts with a --- block holding date, area and title")
	}
	fields := map[string]string{}
	for _, line := range strings.Split(match[1], "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			return Note{}, bad("%q is not 'key: value'", line)
		}
		fields[strings.ToLower(strings.TrimSpace(key))] = strings.TrimSpace(value)
	}
	for _, key := range []string{"date", "area", "title"} {
		if fields[key] == "" {
			return Note{}, bad("%s is missing", key)
		}
	}
	if _, err := time.Parse(time.DateOnly, fields["date"]); err != nil {
		return Note{}, bad("date must be YYYY-MM-DD")
	}
	if fields["date"] != slug[:10] {
		return Note{}, bad("the date in the name and the date inside differ")
	}
	known := false
	for _, area := range Areas {
		known = known || area == fields["area"]
	}
	if !known {
		return Note{}, bad("area must be one of %s", strings.Join(Areas, ", "))
	}
	if link := fields["link"]; link != "" && !strings.HasPrefix(link, "/") {
		return Note{}, bad("link is a path in the app, starting with /")
	}
	var paragraphs []string
	for _, part := range paragraphBreak.Split(strings.TrimSpace(match[2]), -1) {
		if line := strings.Join(strings.Fields(part), " "); line != "" {
			paragraphs = append(paragraphs, line)
		}
	}
	if len(paragraphs) == 0 {
		return Note{}, bad("say what changed below the --- block")
	}
	return Note{
		Slug: slug, Date: fields["date"], Area: fields["area"], Title: fields["title"],
		Paragraphs: paragraphs, Link: fields["link"],
	}, nil
}

// Load reads every note in dir, by name. A missing dir is no notes (a
// laptop running the API from elsewhere); a broken note fails, and the
// tests load the shipped ones, so the gate refuses it before any deploy.
func Load(dir string) ([]Note, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.md"))
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	notes := make([]Note, 0, len(paths))
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		note, err := Parse(filepath.Base(path), data)
		if err != nil {
			return nil, err
		}
		notes = append(notes, note)
	}
	return notes, nil
}

// Service lists the notes and records who read them.
type Service struct {
	pool  *pgxpool.Pool
	notes []Note
}

// NewService records every shipped note the database has not met yet, as
// arriving now. Instances starting together record a note once.
func NewService(ctx context.Context, pool *pgxpool.Pool, notes []Note) (*Service, error) {
	slugs := make([]string, len(notes))
	for i, note := range notes {
		slugs[i] = note.Slug
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO release_notes (slug) SELECT unnest($1::text[]) ON CONFLICT (slug) DO NOTHING`, slugs); err != nil {
		return nil, fmt.Errorf("recording release notes: %w", err)
	}
	return &Service{pool: pool, notes: notes}, nil
}

// List is the shipped notes, newest day first and, within a day, the one
// that arrived last first, each saying whether email has read it.
func (s *Service) List(ctx context.Context, email string) ([]Note, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT n.slug, n.arrived_at, r.slug IS NOT NULL
		   FROM release_notes n
		   LEFT JOIN release_note_reads r ON r.slug = n.slug AND r.email = $1`, email)
	if err != nil {
		return nil, fmt.Errorf("reading release notes: %w", err)
	}
	type state struct {
		arrived time.Time
		read    bool
	}
	states := map[string]state{}
	for rows.Next() {
		var slug string
		var st state
		if err := rows.Scan(&slug, &st.arrived, &st.read); err != nil {
			rows.Close()
			return nil, fmt.Errorf("reading release notes: %w", err)
		}
		states[slug] = st
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]Note, len(s.notes))
	copy(out, s.notes)
	for i := range out {
		out[i].Read = states[out[i].Slug].read
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date > out[j].Date
		}
		ai, aj := states[out[i].Slug].arrived, states[out[j].Slug].arrived
		if !ai.Equal(aj) {
			return ai.After(aj)
		}
		return out[i].Slug > out[j].Slug
	})
	return out, nil
}

// MarkRead records that email has seen these notes, once per
// Idempotency-Key. A slug the API does not ship is left out rather than
// refused: the page that sent it may have been loaded before a deploy.
// Reading a note twice keeps the first time.
func (s *Service) MarkRead(ctx context.Context, email, key string, slugs []string) error {
	hash, err := idempotency.Hash("release-notes-read", slugs)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		claim, err := idempotency.Begin(ctx, tx, key, email, "release-notes-read", hash)
		if err != nil || claim.Replay {
			return err
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO release_note_reads (email, slug)
			 SELECT $1, slug FROM release_notes WHERE slug = ANY($2::text[])
			 ON CONFLICT (email, slug) DO NOTHING`, email, slugs); err != nil {
			return fmt.Errorf("marking release notes read: %w", err)
		}
		return idempotency.Complete(ctx, tx, key, "read")
	})
}
