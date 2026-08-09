-- 0006: About page v3 — the team's own photo library + "house favourite" layouts.
--
-- custom_photos: brand photos the team uploads from the About page. The image is stored
-- downscaled (client side, long edge ~1800 px JPEG) plus a small thumbnail for the gallery.
-- Enabled photos are offered to the deck planner alongside the built-in photo library, keyed
-- `team_photo_<id>`, with the user's description as the AI's guidance for when to pick it.
--
-- layout_settings.preferred: beyond on/off, a "house favourite" star — when several layouts
-- fit a point equally well, the planner is told to prefer the starred ones. A disabled
-- layout cannot be preferred (the API enforces it; the planner also filters).

create table custom_photos (
  id          text primary key,
  name        text not null,
  description text not null default '',
  enabled     boolean not null default true,
  image_b64   text not null,
  thumb_b64   text,
  sort_order  int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table layout_settings add column preferred boolean not null default false;

-- Same access model as the rest of the schema: service role only.
alter table custom_photos enable row level security;
