# EyeWire II server functions

Everything EyeWire II runs on a server, in one place:

| Function | What it does |
|---|---|
| `slackBot` | "@Amy's Claude" in Slack: answers questions, reads triage status, reviews Guide answers |
| `guideAssistant` | Nurro, the in-app Guide |
| `guideFeedback` | thumbs up or down on a Guide answer |
| `submitIssue` | the in-app "report an issue" form, posted to Slack |
| `caveProxy` | fixed CAVE lookups the browser cannot make directly |
| `signScreenshotUpload` | retired, answers 410 |
| `ewSecureWrite` | admin writes (notifications, triage) after a verified CAVE sign in |
| `ewCommunityData` | private community reads and writes after a verified CAVE sign in |
| `ewSecureUpload` | image uploads after a verified CAVE sign in |

Until 2026-09-27 these lived in the philogelos repo (ytho.club) and ran in
its Firebase project `ytho-4bff2`, sharing its secrets. They were moved here
so EyeWire II has its own code, secrets and project.

## Deploy

From the repo root (not from `functions/`):

```bash
firebase deploy --only functions,firestore:rules --project <eyewire project id>
```

Run the tests first: `cd functions && npm ci --legacy-peer-deps && npm test`.

## Secrets

Set with `firebase functions:secrets:set NAME --project <id>`, typed or
pasted by a person, never committed:

- `ANTHROPIC_API_KEY`: Guide and Slack bot
- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`: the Slack app
- `EW_SUPABASE_SERVICE_KEY`: a Supabase `sb_secret_` key, used only on the server

## Firestore

Collections: `bot_memory`, `guide_logs`, `guide_review_threads`,
`guide_feedback`, `site_issues`, `guide_ratelimit`, `slack_events_seen`.
`firestore.rules` denies all browser access; the functions use the Admin SDK.

`bot-docs.json` lists reference docs uploaded to Anthropic Files; they are
readable only with a key from the same Anthropic workspace.
