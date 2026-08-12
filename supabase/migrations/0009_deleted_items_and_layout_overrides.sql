-- 0009: "Deleted items" (soft delete, restorable) across both libraries, editable titles/
-- descriptions for BUILT-IN slides and photos, and layout overrides — a built-in layout whose
-- DESIGN the team replaced from an uploaded .pptx while the AI keeps writing its text.
--
-- removed is a separate, stronger state than enabled: a removed item leaves the library grid
-- entirely (and the planner's vocabulary) and sits in the "Deleted items" view until restored.
-- Team-uploaded items can additionally be purged for real (the old hard-delete path, now behind
-- ?purge=1 on the DELETE routes).
--
-- layout_settings/photo_settings gain display_name + description (null = the built-in default),
-- so built-in cards can be retitled/redescribed from the UI without touching
-- layout-gallery.json / photo-library.json.

alter table custom_slides add column removed boolean not null default false;
alter table custom_photos add column removed boolean not null default false;

alter table layout_settings
  add column removed boolean not null default false,
  add column display_name text,
  add column description text;

alter table photo_settings
  add column removed boolean not null default false,
  add column display_name text,
  add column description text;

-- One design override per built-in layout key. file_id points at the same custom_slide_files
-- store the team-slide uploads use (each override always gets its OWN file row, never shared
-- with a custom_slides row, so the existing garbage-collection logic stays correct). slots is
-- the text-slot map the deck service's /slides/inspect-slots endpoint measured from the
-- uploaded design: which text boxes exist, what they say now, and how much text fits in each —
-- the AI writes fresh text into those boxes at generation time while the design stays verbatim.
create table layout_overrides (
  layout      text primary key,
  file_id     text not null references custom_slide_files(id),
  slide_index int  not null default 0,
  slots       jsonb not null default '[]'::jsonb,
  preview_b64 text,
  enabled     boolean not null default true,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table layout_overrides enable row level security;
