-- 0007: photo library on/off + "house favourite" stars, for BOTH the built-in photo
-- library and the team's own uploaded photos — parity with layout_settings.
--
-- photo_settings mirrors layout_settings but keyed by the built-in photo id (app/photo-library.json,
-- e.g. "photo_capsule_single"). Absence of a row means "enabled, not preferred" (the built in
-- default). A disabled built-in photo is removed from the planner's asset_id vocabulary entirely
-- (see planner.sanitize_disabled_photos); a preferred one is named as a house favourite. There is
-- no LOCKED set here — unlike layouts, no single built-in photo is structurally required.

create table photo_settings (
  photo_id    text primary key,
  enabled     boolean not null default true,
  preferred   boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table photo_settings enable row level security;

alter table custom_photos add column preferred boolean not null default false;
