-- 0003: editable categories, per study category assignment, reviewer set scientific quality.
--
-- Until now a study's benefit categories were hard coded in ARCHIVE_CATEGORIES (app/studies.ts)
-- and the `categories` table only served the findings library. The table is now the single
-- source of truth for category NAMES (so a rename shows up on both pages at once), and the two
-- tables below are the override layer that lets a reviewer move a study between categories and
-- set or change its scientific quality from the UI.
--
-- study_categories: absence of rows for a pmid means "use the built in assignment from
-- app/studies.ts". One or more rows REPLACE that assignment completely.

create table study_categories (
  pmid        text not null,
  category_id text not null references categories(id) on delete cascade,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (pmid, category_id)
);

create index study_categories_category_idx on study_categories (category_id);

-- Reviewer set scientific quality. Overrides the curated score in app/studies-data.ts, and is
-- the ONLY source of quality for the studies that never had one. Reviewer and date are required
-- so every score is attributable, the same accountability rule the claims library follows.
create table study_quality (
  pmid        text primary key,
  score       int  not null check (score >= 0 and score <= 100),
  label       text not null check (label in ('High', 'Moderate', 'Low')),
  note        text,
  reviewed_by text not null,
  reviewed_at timestamptz not null default now()
);

-- Audit trail for quality changes (mirrors claim_events).
create table study_quality_events (
  id         bigint generated always as identity primary key,
  pmid       text not null,
  actor      text not null,
  action     text not null check (action in ('set', 'cleared')),
  score      int,
  label      text,
  note       text,
  created_at timestamptz not null default now()
);

create index study_quality_events_pmid_idx on study_quality_events (pmid);

-- Same access model as the rest of the schema: service role only.
alter table study_categories     enable row level security;
alter table study_quality        enable row level security;
alter table study_quality_events enable row level security;
