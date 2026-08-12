-- 0014: the writing rules that were buried in the AI's instructions become ordinary rule rows.
--
-- Until now roughly a dozen instructions lived inside the planner's system prompt: how action
-- titles must read, bullet discipline, how much text a box should carry, what speaker notes must
-- contain, whether slides alternate light and dark, and so on. They shaped every deck and could
-- only be changed by editing the code, which is exactly what the team asked to get away from.
--
-- builtin_key identifies a row as the team's copy of one of those built in instructions
-- (planner.BUILTIN_BLOCKS is the source of the default text, so the two cannot drift). The rows
-- are imported once, on first view of the Rules tab, via /api/rules/builtin. From then on they
-- behave like any rule the team wrote: reword it, switch it off, or delete it to remove that
-- instruction from the AI altogether.
--
-- Rows with builtin_key NULL are unaffected: those are the team's own rules and the structure
-- rules from 0013.
--
-- Deliberately NOT surfaced, and still code owned: the CLAIM FIDELITY rules (never state a fact or
-- number the source does not support) and the AI generated disclaimer, because they are integrity
-- and compliance guardrails rather than style; the per box character limits, which are measured
-- from the real slide geometry and would only cause overflow if edited; and the two prompt blocks
-- that compute numbers from the requested deck length, which would mean handing the team text with
-- placeholders in it.

alter table generation_rules add column builtin_key text;

create unique index generation_rules_builtin_key_idx
  on generation_rules (builtin_key) where builtin_key is not null;
