-- 0016: three client decisions from 2026-08-17, all about the Scientific Studies page.
--
-- 1. The paper's own ABSTRACT replaced the AI written Background/Design/Findings/Limitations
--    summary as the study library's text of record, everywhere, including what the deck / blog /
--    whitepaper generators are fed. The base text now ships in app/study-abstracts.json (fetched
--    verbatim from PubMed); study_assessment.abstract already existed as the reviewer's override
--    and keeps that job, so nothing is added here for it.
--    Consequence: summary_overrides is now DEAD. It is deliberately left in place rather than
--    dropped so the team's earlier edits stay recoverable; nothing reads it.
--
-- 2. "Verified by science" became a deliberate tick. It used to be DERIVED: the 5 curated trials
--    were verified by definition, and editing any summary silently flipped a study to verified
--    (wiki-v2.tsx did `edited ? true : s.verified`). Both couplings are gone. Every study now
--    starts unverified and a reviewer ticks it, attributed like every other override.
--
-- 3. Every study records what Aker BioMarine's role in it actually was, as a tag rather than the
--    old free text akerNote (which only existed on 5 studies). The built in default per study is
--    hand authored in studies.ts AKBM_ROLES from each paper's own funding and conflict of
--    interest statements; this column is the reviewer's override on top of it.

alter table study_assessment add column verified boolean not null default false;
alter table study_assessment add column akbm_role text
  check (akbm_role in ('akbm_authors', 'akbm_funded', 'product_only', 'independent',
                       'competitor', 'product_unnamed', 'third_party'));

-- A study added through "Add study" carries every field directly (no PubMed lookup, no override
-- layer), so it needs its own copies rather than reading study_assessment.
alter table custom_studies add column verified boolean not null default false;
alter table custom_studies add column akbm_role text
  check (akbm_role in ('akbm_authors', 'akbm_funded', 'product_only', 'independent',
                       'competitor', 'product_unnamed', 'third_party'));
