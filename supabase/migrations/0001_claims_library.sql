-- Claims library, Phase 1.
-- Two tier claims (paper level grounded in verbatim quotes; category level aggregating
-- approved paper claims), approval workflow with audit trail, comments incl. required
-- rejection reasons, asset traceability, and shared summary overrides (replaces the
-- localStorage only store in app/summary-overrides.ts).
--
-- Access model: ONLY the Next.js server (service role key) talks to the database.
-- RLS is enabled with no policies so the anon key can read/write nothing.

-- ── Reference data ──────────────────────────────────────────────────────────

create table categories (
  id          text primary key,
  parent      text not null check (parent in ('science', 'marketing')),
  name        text not null,
  sort_order  int not null default 0
);

insert into categories (id, parent, name, sort_order) values
  ('heart',            'science',   'Heart & lipids',            1),
  ('brain',            'science',   'Brain & cognition',         2),
  ('joints',           'science',   'Inflammation & joints',     3),
  ('muscle',           'science',   'Muscle & performance',      4),
  ('eye',              'science',   'Eye health',                5),
  ('metabolism',       'science',   'Metabolism & gut',          6),
  ('mechanism',        'science',   'Mechanism of action',       7),
  ('absorption',       'science',   'Bioavailability & absorption', 8),
  ('safety_dosage',    'science',   'Safety & dosage',           9),
  ('other_science',    'science',   'Other science',            10),
  ('differentiators',  'marketing', 'Differentiators',          11),
  ('sustainability',   'marketing', 'Sustainability & sourcing',12),
  ('certifications',   'marketing', 'Certifications & quality', 13),
  ('product',          'marketing', 'Product & specs',          14),
  ('messaging',        'marketing', 'Messaging & taglines',     15);

-- ── Studies ─────────────────────────────────────────────────────────────────

create table studies (
  id                uuid primary key default gen_random_uuid(),
  pmid              text unique,
  doi               text,
  title             text not null,
  authors           text,
  year              int,
  journal           text,
  verification      text not null default 'ai' check (verification in ('curated', 'ai')),
  full_text         text,   -- source text used for quote verification
  full_text_source  text check (full_text_source in ('pmc_oa', 'upload', 'abstract_only')),
  created_at        timestamptz not null default now()
);

-- ── Claims ──────────────────────────────────────────────────────────────────

create table claims (
  id           uuid primary key default gen_random_uuid(),
  scope        text not null check (scope in ('paper', 'category')),
  claim_type   text not null check (claim_type in ('science', 'marketing')),
  category_id  text not null references categories(id),
  study_id     uuid references studies(id),
  text         text not null,
  status       text not null default 'pending_review'
               check (status in ('draft', 'pending_review', 'approved', 'rejected', 'superseded')),
  origin       text not null check (origin in ('ai_extracted', 'human')),
  created_by   text,
  approved_by  text,
  approved_at  timestamptz,
  version      int not null default 1,
  supersedes   uuid references claims(id),
  created_at   timestamptz not null default now(),
  constraint paper_claims_need_study check (scope <> 'paper' or study_id is not null)
);

create index claims_study_idx    on claims (study_id);
create index claims_category_idx on claims (category_id, status);
create index claims_status_idx   on claims (status);

-- Verbatim grounding for paper level claims (the anti hallucination layer).
create table claim_quotes (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references claims(id) on delete cascade,
  quote       text not null,
  location    text,
  verified    boolean not null default false,  -- deterministic match against studies.full_text
  verified_at timestamptz
);

create index claim_quotes_claim_idx on claim_quotes (claim_id);

-- Category claims cite the paper claims they aggregate;
-- marketing claims cite the science claims that back them.
create table claim_links (
  parent_claim_id uuid not null references claims(id) on delete cascade,
  child_claim_id  uuid not null references claims(id),
  relation        text not null check (relation in ('aggregates', 'backed_by')),
  primary key (parent_claim_id, child_claim_id)
);

-- Discussion and rejection reasons, per claim.
create table claim_comments (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid not null references claims(id) on delete cascade,
  author     text not null,
  body       text not null,
  kind       text not null default 'comment' check (kind in ('comment', 'rejection_reason')),
  created_at timestamptz not null default now()
);

create index claim_comments_claim_idx on claim_comments (claim_id);

-- Audit trail: every status change, who and when.
create table claim_events (
  id          bigint generated always as identity primary key,
  claim_id    uuid not null references claims(id) on delete cascade,
  actor       text not null,
  from_status text,
  to_status   text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index claim_events_claim_idx on claim_events (claim_id);

-- ── Output traceability ─────────────────────────────────────────────────────

create table generated_assets (
  id         uuid primary key default gen_random_uuid(),
  asset_type text not null check (asset_type in ('deck', 'blog', 'whitepaper')),
  title      text,
  created_by text,
  created_at timestamptz not null default now()
);

create table asset_claims (
  asset_id         uuid not null references generated_assets(id) on delete cascade,
  claim_id         uuid not null references claims(id),
  slide_or_section text,
  primary key (asset_id, claim_id)
);

-- ── Shared summary overrides (replaces localStorage) ───────────────────────

create table summary_overrides (
  pmid        text primary key,
  background  text not null,
  design      text not null,
  findings    text not null,
  limitations text not null,
  edited_by   text,
  updated_at  timestamptz not null default now()
);

-- ── Lock everything down: server (service role) only ───────────────────────

alter table categories        enable row level security;
alter table studies           enable row level security;
alter table claims            enable row level security;
alter table claim_quotes      enable row level security;
alter table claim_links       enable row level security;
alter table claim_comments    enable row level security;
alter table claim_events      enable row level security;
alter table generated_assets  enable row level security;
alter table asset_claims      enable row level security;
alter table summary_overrides enable row level security;
