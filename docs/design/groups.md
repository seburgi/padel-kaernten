# Groups

## How it works

- **Groups form themselves** (Seb, 2026-10-27): anyone in the app founds
  one (`POST /api/v1/groups`) and is its admin. A group is `private`
  (invitation only, unseen from outside), `on_request` (seen by everyone in
  the app; a member lets someone in) or `open` (anyone in the app joins).
  Admins rename it and change its kind.
- **Where a group plays** (Seb, 2026-10-28): `groups.area` (migration
  0007) is `alle` (the default), `halle` or `freiluft`, and the fits leave
  the other courts out (`games.md`). Any member sets it (`PATCH
  /api/v1/groups/{id}` with only `area`); the name and the kind stay the
  admins'. The app offers it as Beides, Halle, Freiluft under Verwalten, and
  the group's page and its fits say where it plays.
- **Who sees a group is the view `group_visibility`** (migration 0003): a
  member, someone invited into it, or anyone in the app (`people`) when it
  is not private. Every read joins it; a group out of sight answers 404
  `no-group`, so a private group's existence does not leak. Members see
  its open invitations and requests; others see only the members.
- **`people` is everyone who opened the app**: `GET /api/v1/me` writes the
  row, `PUT /api/v1/me/name` sets the name the others see (1 to 40
  characters). Spielen asks for it while there is none; Mehr › Dein Name
  (`/profile`) changes it. There is no other account row; a person is the lower-cased
  email from the gateway's note. `welcomed_at` says they have seen the
  welcome (`help.md`).
- **Every member invites** (Seb, 2026-10-28), into the group, by address
  (`POST /api/v1/groups/{id}/invitations`). The platform service holds the
  invitation under the ref `group-<id>` (`PUT /v1/invitations/{email}/group-<id>`),
  which puts the person into the sign-in group `padel` and, if Rauthy does
  not know them, makes Rauthy mail them a link to set a password. Only
  when that worked is the invitation saved. At most 20 open invitations
  and 10 new a day per person (429 `invite-limit`).
- **Answering**: `POST …/join` accepts an invitation, joins an open group,
  or asks into one open on request (`state: requested`); any member then
  lets them in (`PUT …/members/{email}`) or turns them down (`DELETE
  …/requests/{email}`). Declining an invitation, or taking one back
  (whoever sent it, or an admin), is `DELETE …/invitations/{email}` and
  drops the ref at the platform service.
- **Leaving** (`DELETE …/members/{email}`, oneself, or an admin removing
  someone) drops the ref `group-<id>` too. The platform service takes the
  person out of `padel` only when no invitation of theirs is left and only
  if it put them in, so Seb's own invitation into the app (ref `padel`,
  `invitations.md`) and other groups keep them in. When the last admin
  leaves, the member in longest becomes admin; when the last member
  leaves, the group and its open invitations go.
- **The first group** (Seb, 2026-10-28): at start-up, when there is no
  group yet, the API founds "Padel Kärnten", private, with `OWNER_EMAIL`
  as admin and everyone in `invitations` as a member (`EnsureFirst`, under
  an advisory lock). Their invitation into the app stays.
- **Where the app opens** (Seb, 2026-10-29): at its bare address, someone
  in a group starts on Spielen; anyone else on Plätze. Only the entry the
  app opened on (`App.tsx`, the router's key "default"); a tap on Plätze
  stays there. `tools/browse.mjs` and `help-shots.mjs` expect it.
- **In the app** (`services/app/src/groups`): the tab Spielen (`/play`)
  answers "Was steht an?" (Seb, 2026-10-29): it asks a person without a
  name for one, then shows "Wartet auf dich" (the games slice's unanswered
  games, with the invitations to accept or decline from here, as a card
  the colour of a warning), the games and "Passt für vier" (both from the
  games slice; `App.tsx` puts them in), and last the groups one is in,
  with Gruppen finden and Neue Gruppe; `/groups` lists the groups one can
  join or ask into, `/groups/new` founds one, `/groups/{id}` is for playing: to members
  its fits and games, a note when someone asks in, and to everyone the
  members with their days entered. Everything about the group itself is
  its own page Verwalten (`/groups/{id}/settings`, members only; Seb,
  2026-10-29): where it plays, the members (removing them, admins),
  requests, inviting and the open invitations, the name and kind
  (admins), and leaving.
- The member list carries `daysEntered`, on how many of the next 14 days
  each member said when they can (`availability.md`); transport joins the
  two slices.
- **Wer kann wann** (Seb, 2026-10-31, feedback #68): on a group's page,
  under Passt für vier, the next 14 days of the whole group, every half
  hour from 6 to 24, the darker the more members can, with a dot from
  four (`groups/WhoCan.tsx`). `GET /api/v1/groups/{id}/availability`
  gives every member's spans and declined days, members only: an open
  group shows its members to anyone, never their times (404 `no-group`).
  Wide, the days are rows and a hover names who can in that half hour; a
  click opens the day. On a phone the grid turns, days side by side and
  the time running down, and a tap on a day opens it in the app's sheet:
  blocks of time with their names, then who declined and who left it
  open. Seb chose the overlay over a row per member because it scales
  with the group.

## Deliberately not

- **No Rauthy group per Padel group** (Seb, 2026-10-28): `padel` stays the
  one sign-in group; `group-<id>` is only the platform service's ref.
- **No mail from the app.** Someone invited who already has an account
  sees the invitation the next time they open Padel.
- **No handing over as an admin yet**, and no second admin by hand: the
  longest member takes over when the last admin leaves.
- **Where a group plays is not per person**: one choice for the group, so
  everyone sees the same fits. Someone who never plays outdoors says so
  in the group, or the group picks Halle.
- **Groups are not paged**: a person sees a handful.
- **Wer kann wann shows no courts**: whether a court is free is Passt für
  vier's (`games.md`); the grid only says who can.

## Traps

- **A key per write**: every POST, PUT and PATCH here takes an
  `Idempotency-Key`; a replay answers the first result.
- **Accepting keeps the ref**: after `join` the platform service still
  holds `group-<id>` for the person; it now stands for the membership and
  is dropped when they leave. Someone who joined an open group without an
  invitation has no ref, and dropping it is harmless.
- **The view is a contract**: changing `group_visibility` is a migration
  and a test of each branch (`groups_test.go`).
