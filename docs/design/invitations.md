# Invitations

## How it works

- **Only Seb invites, from the app** (Seb, 2026-10-27): the page
  `/einladen`, shown only to `OWNER_EMAIL`. Everyone else gets 403
  `not-owner` from `/api/v1/invitations`, and the app does not show the
  page.
- **Inviting** (`POST /api/v1/invitations`, with an `Idempotency-Key`)
  asks the platform service to put the address into Rauthy's group
  `padel`: `PUT {PLATFORM_URL}/v1/invitations/{email}/padel` with the
  service's own Google ID token. Only when that worked is the invitation
  saved here, so the list never shows someone who cannot sign in.
- **Withdrawing** (`DELETE /api/v1/invitations/{email}`) asks the platform
  service to drop the invitation (`DELETE` of the same address), then
  removes it here.
- The invited person signs in at `padel.burgstaller.me` with that address.
  Rauthy mails someone new a link to set a password; someone who already
  has an account (from another of Seb's apps) gets no mail, so Seb tells
  them.
- Addresses are lower-cased and must look like an address with a domain
  that has a dot (400 `invalid-email`). The list pages with a cursor.

## Deliberately not

- **No invitations by members.** Seb chose "only me, but in the app".
- **No Rauthy key here.** Only the platform service may change groups, and
  only for the app whose account calls it (`PLATFORM_APPS` in
  `infra/platform/app-platform.tf`).
- **No mail from the app.** Rauthy sends it.

## Traps

- **People Seb put into the group by hand stay** when an invitation is
  withdrawn: the platform service removes only what an invitation added.
  Seb himself must be in the group `padel` to get past the gateway.
- When the platform service fails, inviting fails with 502
  `platform-failed` and nothing is saved; the same key may be sent again.
