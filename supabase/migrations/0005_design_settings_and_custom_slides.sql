-- 0005: About page v2 — deterministic design settings + the team's own verbatim slides.
--
-- design_settings: ONE row (id='default') holding a JSON object of overrides the RENDERER
-- enforces deterministically (fonts, the three text sizes, line spacing, page margin, box
-- gutter). Absence of a key means "brand template default". This is different from
-- generation_rules (0004): rules steer the AI's writing; design settings restyle the drawn
-- slides in code, so a non-technical user's "use Arial, 12pt body" actually happens.
--
-- custom_slide_files: an uploaded .pptx, stored whole (base64) so any slide in it can be
-- spliced verbatim into generated decks with images intact. Kept under ~10 MB per file.
--
-- custom_slides: one row per slide the team picked from an uploaded file. `mode`:
--   'auto'   — the AI may place the slide where it fits the storyline (offered to the
--              planner as a verbatim layout with the user's description),
--   'always' — spliced into EVERY generated deck (like the benefits overview),
--   'off'    — kept in the library but not used.
-- The PNG preview is stored so the About page gallery needs no rasteriser.

create table design_settings (
  id         text primary key default 'default',
  settings   jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table custom_slide_files (
  id         text primary key,
  filename   text not null,
  pptx_b64   text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table custom_slides (
  id          text primary key,
  file_id     text not null references custom_slide_files(id) on delete cascade,
  slide_index int  not null,
  name        text not null,
  description text not null default '',
  mode        text not null default 'auto' check (mode in ('auto', 'always', 'off')),
  preview_b64     text,
  sort_order  int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create index custom_slides_file_idx on custom_slides (file_id);

-- Same access model as the rest of the schema: service role only.
alter table design_settings    enable row level security;
alter table custom_slide_files enable row level security;
alter table custom_slides      enable row level security;
