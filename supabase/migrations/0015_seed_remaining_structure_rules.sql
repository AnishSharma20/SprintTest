-- 0015: seed the four structure rules 0014 forgot.
--
-- A real regression, caught by generating an actual deck. 0014 taught the pipeline four more
-- guarantees — the "Proven Health Benefits" slide, speaker notes on every slide, the no-dash brand
-- rule, and the source charts appendix — but only 0013's three rows were ever seeded. Because the
-- app sends the rule list as the authoritative answer (an empty or partial list means "the team
-- decided this", by design, so deleting a rule really releases its guarantee), a database with
-- only those three rows read as "the team switched the other four off". They were silently absent
-- from every deck.
--
-- Seeding them restores the intended behaviour and makes each one visible and editable, which was
-- the point. `on conflict do nothing` is not usable here (there is no unique key on these columns),
-- so each insert is guarded by a not-exists check and the migration is safe to run twice.

insert into generation_rules (text, enabled, sort_order, slide_key, action, position, created_by)
select 'The Proven Health Benefits slide is included, second to last', true, -4,
       'benefits_verbatim', 'position', 'second_to_last', 'built in'
where not exists (select 1 from generation_rules where slide_key = 'benefits_verbatim');

insert into generation_rules (text, enabled, sort_order, slide_key, action, position, created_by)
select 'Every slide carries presenter notes', true, 1, null, 'speaker_notes', null, 'built in'
where not exists (select 1 from generation_rules where action = 'speaker_notes');

insert into generation_rules (text, enabled, sort_order, slide_key, action, position, created_by)
select 'No dash characters in any text the AI writes', true, 2, null, 'no_dashes', null, 'built in'
where not exists (select 1 from generation_rules where action = 'no_dashes');

insert into generation_rules (text, enabled, sort_order, slide_key, action, position, created_by)
select 'Decks built from picked studies end with an appendix of those studies'' own charts and tables',
       true, 3, null, 'source_appendix', null, 'built in'
where not exists (select 1 from generation_rules where action = 'source_appendix');
