# Deliver feedback replies to the intended audience

The feedback team needs dependable personal replies. The Slack bridge and
Admin Hub previously fell back to an all-user notification when a report had
no user account. That makes a personal response visible to unrelated players.

Approved replies must target the actual reporter. Lookup and delivery errors
must leave the proposal available for recovery. In Admin Hub, a missing
recipient produces an actionable error. In Slack, an anonymous report gets its
reply in the existing report thread, with clear confirmation that no in-app
notification was sent. Empty replies cannot be approved.

The Slack thread reply must succeed before approval is saved. A stable marker
and paginated history lookup recover from a successful post followed by a failed
status update. Workflow concurrency serializes bridge runs; the existing bridge
remains the only publisher. This does not add transactional deduplication for
the existing targeted notification path.

Validation: `node --test scripts/slack-triage-bridge.test.mjs` covers targeting,
anonymous reports, missing text, failed lookups/inserts/posts, and reply recovery.
Live Slack and authenticated Admin Hub verification remain required before
release. No schema changes or permission changes are included.
