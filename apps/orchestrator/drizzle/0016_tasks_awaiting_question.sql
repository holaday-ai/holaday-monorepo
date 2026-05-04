-- Audit fix F11 — persist supercar's awaiting_user prompt.
--
-- Before: the question text the agent asks the user when it pauses
-- only existed as a transient WebSocket frame. A page reload during
-- the pause window meant the SPA had no state to rebuild the input
-- box from — the user saw a stuck task with no way to reply.
--
-- After: tasks.awaiting_question carries the latest prompt; tasks.
-- detail surfaces it to the SPA on (re)hydrate. We don't strictly
-- need to clear it on resume — the SPA gates rendering on
-- status='awaiting_user' — but we do clear when the task moves
-- terminal so historical rows don't stay decorated with a question
-- that no longer makes sense.

ALTER TABLE `tasks` ADD COLUMN `awaiting_question` text NULL;
