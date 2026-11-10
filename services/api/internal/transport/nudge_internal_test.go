package transport

import (
	"slices"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
)

func TestPlayed(t *testing.T) {
	ahead := []games.Game{
		{GroupID: 1, Day: "2026-11-12", Start: 1170, Minutes: 90, Lineup: []games.Player{
			{Email: "seb", State: games.In}, {Email: "anna", State: games.Reserve}}},
		{GroupID: 2, Day: "2026-11-13", Lineup: []games.Player{{Email: "lisa", State: games.In}}},
	}
	can := []string{"seb", "anna", "markus", "lisa", "eva"}
	fits := []games.Fit{
		{Day: "2026-11-12", Start: 1080, Can: can},                              // the group's game day: gone
		{Day: "2026-11-13", Start: 1080, Can: can, Ask: []string{"lisa", "jo"}}, // lisa plays elsewhere
		{Day: "2026-11-14", Start: 1080, Can: can},
	}
	got := played(ahead, 1, fits, 4)
	if len(got) != 2 || got[0].Day != "2026-11-13" || got[1].Day != "2026-11-14" {
		t.Fatalf("played: %+v", got)
	}
	if !slices.Equal(got[0].Can, []string{"seb", "anna", "markus", "eva"}) || !slices.Equal(got[0].Ask, []string{"jo"}) {
		t.Errorf("the 13th: %+v", got[0])
	}
	if len(fits[1].Can) != 5 {
		t.Error("played changed its input")
	}
	// Group 2 on the 12th: Seb is in a game of group 1, a reserve is free.
	if got := played(ahead, 2, fits[:1], 4); len(got) != 1 || !slices.Equal(got[0].Can, []string{"anna", "markus", "lisa", "eva"}) {
		t.Errorf("group 2 on the 12th: %+v", got)
	}
	// Fewer than four left is no fit.
	if got := played(ahead, 2, []games.Fit{{Day: "2026-11-12", Can: can[:4]}}, 4); len(got) != 0 {
		t.Errorf("three left: %+v", got)
	}
}
