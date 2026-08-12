-- 0009: separate "was the study rigorous" from "did it come out positive", add a sentiment
-- tag per finding, a Science team assessment layer per study, and a reversible way to remove
-- a study from the Scientific Studies page.
--
-- Motivation: study_quality's score/label already means research rigor (see the page's own
-- "NOT whether the result was positive" definition) but had nowhere else to route a reviewer's
-- judgement about the RESULT, so the two got conflated in practice. Real example fixed below:
-- KARAOKE (Laslett 2024, PMID 38776073) is a rigorous, well powered JAMA RCT that simply found
-- no significant effect; it had been scored 25%/Low as if the null result made the study itself
-- bad. Both can now be recorded: rigor High, outcome negative.

alter table study_quality add column outcome_direction text
  check (outcome_direction in ('positive', 'neutral', 'negative'));
alter table study_quality_events add column outcome_direction text
  check (outcome_direction in ('positive', 'neutral', 'negative'));

update study_quality
  set score = 100, label = 'High', outcome_direction = 'negative'
  where pmid = '38776073';

-- Per finding sentiment, so a presentation can show balanced evidence rather than cherry
-- picked positives. Nullable: existing findings predate this field and are not backfilled
-- with a guess (they show as "not yet assessed" until a reviewer sets one).
alter table claims add column sentiment text check (sentiment in ('positive', 'neutral', 'negative'));

-- The Science team's own write up per study: the abstract as they read it, and their own
-- assessment of the key findings. Distinct from the page's existing AI/curated Background /
-- Design / Findings / Limitations summary, and from the numeric quality score.
create table study_assessment (
  pmid                     text primary key,
  abstract                 text,
  key_findings_assessment  text,
  updated_by               text,
  updated_at               timestamptz not null default now()
);

alter table study_assessment enable row level security;

-- Remove a study from the Scientific Studies page (and the content generator's study picker)
-- without deleting it or any findings grounded in it. Reversible and attributed, the same
-- pattern as layout_settings/photo_settings' enabled flag.
create table study_removed (
  pmid       text primary key,
  reason     text,
  removed_by text not null,
  removed_at timestamptz not null default now()
);

alter table study_removed enable row level security;
