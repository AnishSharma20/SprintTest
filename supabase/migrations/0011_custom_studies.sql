-- 0011: user added studies. A reviewer can upload a study PDF the Scientific Studies page
-- otherwise has no way to carry — one AKBM never supplied as part of the curated/full text
-- library, or one with no PMID at all (see STATUS.md's Ding 2024 note: "doesn't fit the site's
-- PMID keyed model... left out pending a decision on how to represent a non-PubMed source").
--
-- Unlike study_quality/study_categories/study_assessment/study_removed (all override layers on
-- top of a built in base row keyed by pmid), a custom study IS the row — there is no base entry
-- to override, so every field the page needs lives here directly. Merged into hentStudier()'s
-- list (app/studies.ts) alongside the curated + full text studies.
--
-- The PDF itself lives in Storage, not Postgres, same reasoning as migration 0008: the browser
-- uploads straight to Storage via a signed URL (app/api/custom-studies/upload-url), so the file
-- never transits Vercel's serverless body ceiling.

create table custom_studies (
  id                       uuid primary key default gen_random_uuid(),
  pmid                     text,
  doi                      text,
  title                    text not null,
  authors                  text,
  year                     int,
  journal                  text,
  storage_path             text not null,
  pdf_filename             text,
  full_text                text,
  abstract                 text,
  key_findings_assessment  text,
  quality_score            int check (quality_score >= 0 and quality_score <= 100),
  quality_label            text check (quality_label in ('High', 'Moderate', 'Low')),
  outcome_direction        text check (outcome_direction in ('positive', 'neutral', 'negative')),
  category_ids             text[] not null default '{}',
  created_by               text not null,
  created_at               timestamptz not null default now()
);

create index custom_studies_pmid_idx on custom_studies (pmid);

alter table custom_studies enable row level security;

insert into storage.buckets (id, name, public)
values ('custom-studies', 'custom-studies', false)
on conflict (id) do nothing;
