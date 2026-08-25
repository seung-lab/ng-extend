# To-do

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

## Mobile onboarding tour

Make a phone-sized version of the tutorial that shows new mobile users
around the few things they can preview on a phone (Amy 2026-08-24): the
showcase pinky cell in 3D, the Cell Library, chat, profile/badges, and
the leaderboard. The desktop tutorials (store-pyr) drive viewer state
the phone layout doesn't have, so this wants its own short flow — e.g.
3–4 spotlight steps launched from the welcome sheet after first login.
