-- Chat replies (Ames 2026-10-05): a message may point at the one it answers.
-- If the original is deleted, the reply stays and simply loses its quote.
-- Run in the Supabase SQL editor. Safe to re-run.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to UUID REFERENCES chat_messages(id) ON DELETE SET NULL;
