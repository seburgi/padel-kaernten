package transport

import (
	"slices"
	"testing"

	"github.com/seburgi/padel-kaernten/services/api/internal/games"
)

func TestPlannedAndFree(t *testing.T) {
	ahead := []games.Game{
		{GroupID: 1, Day: "2026-11-12", Start: 1170, Minutes: 90, Lineup: []games.Player{
			{Email: "seb", State: games.In}, {Email: "anna", State: games.Reserve}}},
		{GroupID: 2, Day: "2026-11-13", Lineup: []games.Player{{Email: "lisa", State: games.In}}},
	}
	if !planned(ahead, 1, "2026-11-12") || planned(ahead, 1, "2026-11-13") || planned(ahead, 2, "2026-11-12") {
		t.Error("planned: a group's game counts on its day only, at any time")
	}
	can := []string{"seb", "anna", "markus", "lisa"}
	if got := free(ahead, "2026-11-12", can); !slices.Equal(got, []string{"anna", "markus", "lisa"}) {
		t.Errorf("free on the 12th: %v (a reserve is free)", got)
	}
	if got := free(ahead, "2026-11-13", can); !slices.Equal(got, []string{"seb", "anna", "markus"}) {
		t.Errorf("free on the 13th: %v (a game of another group counts)", got)
	}
	if len(can) != 4 {
		t.Error("free changed can")
	}
}
