# Princeton Tracers: their own backend (to do, for Bun)

The Tracers play on their own site,
https://princeton-tracers-dot-brain-wire-dot-seung-lab.ue.r.appspot.com, built
from the `princeton-tracers` branch. Today it is only a different front end.
Everything behind it is shared with the public game (live branch
`eyewire-ii-community`), and much of it runs on Ames's personal accounts.

Everything that differs on the Tracers site checks one flag, `TRACER_EDITION`
in `src/edition.ts`, which is true only on that address or with `?tracers`.
Keep new work behind that flag so the branch keeps merging cleanly from live.

## What is shared today (verified 2026-10-19)

| Piece | Where | Owned by |
|---|---|---|
| Database: users, chat, cells, claims, stats, Achievements, notifications, about 40 tables | Supabase project `javthknksdcrlhiaaptj` (`src/supabase.ts`) | Ames, personal |
| Chat: messages, reactions, who is online | Supabase tables `chat_messages`, `chat_reactions`, `chat_presence`, plus a Realtime channel `eyewire-ii-chat-verified` | Ames, personal |
| Server functions: the data gateway `ewCommunityData`, `ewSecureWrite`, uploads, the guide, the Slack bot | Firebase project `eyewire-ii-e4d52` (`functions/`, base URL in `src/functions_base.ts`) | check with Ames |
| The guide (Nurro) | `guideAssistant`, secret `ANTHROPIC_API_KEY` | Ames, personal credit |
| Scheduled jobs that read or write the database | 17 GitHub Actions workflows with `SUPABASE` secrets (CAVE sync, sheet sync, digest, weekly recap, practice reset, triage) | seung-lab repo secrets |
| Edit permissions | CAVE (HiMC for MEC, Eyewire_2_Edit for Retina), plus the `pilot_members` table | CAVE admins / Admin Hub |

So a Tracer's chat message, claim or completion lands in the same tables as
everyone else's, and is seen by the public players.

## To do, in order

### 1. Their own chat (first)

Goal: Tracers chat with Tracers only, on a server that is not Ames's.

1. Create a new Supabase project owned by the lab (not a personal account).
   This project is the start of step 2 as well, so set it up for the long run.
2. Create the three chat tables from the existing schema. Search the
   `supabase-*.sql` files in the repo root for `chat_messages`,
   `chat_reactions` and `chat_presence`, including their RLS policies and the
   trigger that stamps `joined_at`.
3. Chat goes through the server gateway, never straight from the browser
   (`functions/community-data.js`, read `docs/SECURITY-REMEDIATION.md` first).
   Either deploy a copy of `ewCommunityData` that points at the new project,
   or give the gateway a second database it uses when the request comes from
   the Tracers site. Do not reopen browser-side Realtime broadcasts for
   anything that carries identity.
4. In the chat store (`src/store.ts`, "Chat Store", around the
   `eyewire-ii-chat-verified` channel), pick the client and gateway URL from
   `TRACER_EDITION`.
5. Things that also post into chat and would need a Tracers answer, or to be
   switched off on that site: notifications with "post to chat"
   (`notifications.post_to_chat`), the daily "Today in Pyr" note, the weekly
   recap, the chat announcements workflow, and Nurro's daily summary of chat.
6. Test with two accounts: one on the Tracers site, one on live. Neither may
   see the other's messages, presence or reactions.

### 2. Move off Ames's personal Supabase

Goal: nothing the Tracers use lives on `javthknksdcrlhiaaptj`.

1. In the new project from step 1, load the full schema: the `supabase-*.sql`
   files in the repo root, in the order they were applied (ask Ames, or read
   `HANDOFF.md` and `HANDOFF-BUGFIX-WIP.md`). Include the views, RPCs
   (`pilot_practice_action`, `pilot_is_member` and others), cron jobs and
   storage buckets (`admin-uploads`).
2. Decide with Ames what the Tracers start with: an empty game, or a copy of
   their own existing rows (their user rows, claims, completions).
3. Point the Tracers site at it: `SUPABASE_URL` and the publishable key in
   `src/supabase.ts`, chosen by `TRACER_EDITION`.
4. Server side: the functions read `EW_SUPABASE_SERVICE_KEY`. The Tracers
   need their own functions (or a gateway that knows both databases) with the
   new project's service key as a secret.
5. Scheduled jobs: decide which ones the Tracers need (CAVE edit and
   completion sync at least) and give them the new project's secrets. Leave
   the public game's jobs alone.
6. Admin: the Admin Hub (`admins` table, Pilot testers) must work on the new
   project, so someone can let Tracers in.

### 3. Then, worth deciding

- **Nurro:** runs on Ames's personal Anthropic credit. Turn it off on the
  Tracers site, or give it a lab key.
- **Firebase:** confirm who owns `eyewire-ii-e4d52`. If it is Ames, the
  Tracers' functions belong in a lab project.
- **Practice tutorials:** the Merge and Cut practice cells are shared and
  only one learner at a time can use each. Hide them on the Tracers site, or
  leave them.
- **Leaderboard and stats:** these follow automatically once the database is
  separate, but say so to the Tracers, since today they rank with the public
  players.

## Rules of the repo that apply

- Pushing a branch to `origin` (`seung-lab/ng-extend`) deploys that branch's
  own preview site. Pushing `eyewire-ii-community` deploys the public game:
  never without Ames's say so.
- A push is not a deploy. Check `/build-commit.txt` on the site.
- Player-facing copy: no dashes, American spelling, "Achievement" never
  "badge", the game is called Pyr.
