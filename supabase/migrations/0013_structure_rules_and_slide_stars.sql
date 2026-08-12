-- 0013: rules can GUARANTEE structure, and a team slide can be a house favourite.
--
-- Two changes, both in service of "every slide is equal".
--
-- 1. generation_rules gains an optional structural payload. A rule with slide_key + action is no
--    longer only advice in the planner's prompt: the pipeline applies it. That is what lets the
--    deck's shape be edited on the website instead of living in code —
--      action 'position'        + position 'first'|'second'|'third'|'last'|'second_to_last'
--                                 the slide is moved to exactly that spot after planning
--      action 'always_include'    the slide must appear in every deck; for the cover, agenda and
--                                 executive summary the code can compose one if the AI forgets
--    Rows with slide_key NULL are ordinary writing rules and behave exactly as before, so nothing
--    about existing rules changes.
--
--    The three seeded rows below are the guarantees that used to be hardcoded (cover first,
--    executive summary second, agenda third). Seeding them changes no behaviour — it just makes
--    them visible and editable, and DELETING one genuinely releases that guarantee, which is the
--    point: the cover and agenda cards can then be removed like any other slide.
--
-- 2. custom_slides gains `preferred`, so a slide the team uploaded can be starred as a house
--    favourite exactly like a built-in one (the libraries were otherwise not quite equal).

alter table generation_rules
  add column slide_key text,
  add column action    text,
  add column position  text;

alter table custom_slides add column preferred boolean not null default false;

insert into generation_rules (text, enabled, sort_order, slide_key, action, position, created_by)
values
  ('The cover slide always comes first', true, -3, 'title', 'position', 'first', 'built in'),
  ('The executive summary always comes second, right after the cover', true, -2,
   'exec_summary', 'position', 'second', 'built in'),
  ('The agenda always comes third, right after the executive summary', true, -1,
   'agenda', 'position', 'third', 'built in');
