-- 0004: user editable deck generation settings, managed from the About page.
--
-- generation_rules: free text rules the team writes in the UI. Every ENABLED rule is sent
-- along with each deck generation and injected into the planner's system prompt as
-- high priority guidance (it can never override the claim fidelity rules or the schema's
-- character limits, which always win). Rules are shared across users, like categories.
--
-- layout_settings: per layout on/off override for the code built and template slide
-- layouts. Absence of a row means "enabled" (the built in default). A disabled layout is
-- removed from BOTH the planner's layout guide and the emit_plan tool schema enum, so the
-- model cannot pick it at all. The About page never lets `title` or `agenda` be disabled
-- (every deck needs a cover, and the pipeline's agenda safety net inserts one).

create table generation_rules (
  id         bigint generated always as identity primary key,
  text       text not null,
  enabled    boolean not null default true,
  sort_order int not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table layout_settings (
  layout     text primary key,
  enabled    boolean not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Same access model as the rest of the schema: service role only.
alter table generation_rules enable row level security;
alter table layout_settings  enable row level security;
