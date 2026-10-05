# To-do

## Chat: reply to a message (parked, Ames 2026-09-28)

Click a message to reply: the reply quotes it (name plus a short excerpt,
clickable to scroll back to the original) and pings the original author the
same way an @mention does. Keeps threads readable when a few conversations
overlap. Parked for now; the pieces it needs already exist: message ids are
uuids on `chat_messages`, `mentionsMe` / `mentionPing` drive the flash and the
background alerts, and the gateway would need one new writable column
(`reply_to uuid references chat_messages(id)`) on `chat_messages`.

Shipped alongside it on 2026-09-28: history paging, @ autocomplete,
background mention alerts (tab title + optional notification), Share my
view, and emoji reactions (`supabase-chat-reactions.sql`).


## Mobile welcome sheet: revive the portal copy A/B test

The Citizen Science Mobile Portal section (above LOG IN WITH GOOGLE in
`src/components/MobileWelcome.vue`) currently ships one fixed social-proof
line. A full A/B/C test was built and then parked because mobile traffic is
too thin to measure yet (Amy, 2026-08-24). When there are enough visitors:

- **The wiring exists in git history** — commit `182be75` ("Portal copy beta
  test: three social-proof lines, conversion logged") has the complete
  working implementation: per-device random variant assignment persisted in
  localStorage, one `shown` event per browser session, a `login_tap` event
  per CTA tap, all logged fire-and-forget to Supabase keyed by an anonymous
  device id. Revert-of-revert or cherry-pick to bring it back.
- **The schema is already in the repo** — `supabase-mobile-welcome-ab.sql`
  creates the `mobile_welcome_ab` table (insert-only RLS, same posture as
  `client_errors`) and its header includes the conversion query
  (devices shown vs. devices tapped per variant). Run it once in the
  Supabase SQL editor before re-enabling.
- **Candidate copy** (the shipped line is the first):
  1. People like you have mapped over 40,000 real neurons.
  2. People like you have identified over 50,000 real neurons.
  3. People like you have become authors on real scientific publications.
- Keep the numbers honest when reviving — refresh the neuron counts against
  real stats at that point.

## Mobile onboarding tour — SHIPPED 2026-08-25 (MobileTour.vue)

Built as a 6-step caption-card flow over the bottom nav: viewer, Cells,
Chat, Tags, Alerts, Guide. Runs once per browser on "Just exploring" and
replays from the sheet's "Take the tour". Step one adapts to login state
because meshes need CAVE auth. Possible follow-ups: deep-link each step
into its panel, and a post-login variant that walks a real cell.

### Original note

Make a phone-sized version of the tutorial that shows new mobile users
around the few things they can preview on a phone (Amy 2026-08-24): the
showcase pinky cell in 3D, the Cell Library, chat, profile/badges, and
the leaderboard. The desktop tutorials (store-pyr) drive viewer state
the phone layout doesn't have, so this wants its own short flow — e.g.
3–4 spotlight steps launched from the welcome sheet after first login.

## Chat: private messages and groups (ideas, Ames 2026-10-05)

Alongside replies (above), Ames named two more chat directions. Neither is
built.

- **Private messages.** One player to another. `chat_messages` is public
  today (every signed in client subscribes to all of it), so PMs need their
  own table with owner-only reads through the gateway, plus realtime that
  only delivers to the two people. Nurro's "we don't have PMs" answers in
  `src/chat_bot.ts` would change with it.
- **Group channels** (Scouts, Mystics and so on, as in the original EyeWire).
  A channel picker in the chat header; messages carry a channel; membership
  could reuse `user_groups` / `user_group_members`, which already exist for
  notification targeting and shared links. Open question: can anyone read a
  group's channel, or only its members?
