-- 0016 — scope every team setting to a BRAND.
--
-- Until now the tool served one brand, so each of these tables held exactly one install's worth
-- of state: one design_settings row, one on/off switch per layout, one photo library. Revervia
-- now renders real decks with its own template, palette, photos and icons, and the About page
-- lets you pick which brand you are configuring — so a Revervia visit was showing SUPERBA's
-- fonts, slide renders and krill photos under a Revervia heading, and a Revervia deck would
-- otherwise splice Superba's uploaded team slides into it.
--
-- Every table gains `brand`, defaulting to 'superba'. That default is what makes this safe on a
-- live database: every existing row IS Superba's, so it keeps working untouched and the Superba
-- UI cannot tell the difference.
--
-- Uniqueness widens with it. A per-layout switch was `layout text primary key`, so Superba's
-- "funnel: off" would have applied to Revervia too — or blocked Revervia from holding its own
-- row at all. Each primary key is widened to (brand, key) rather than replaced by a plain unique
-- index, because the API routes upsert with no explicit conflict target and therefore rely on the
-- PRIMARY KEY being the thing they conflict on. Nothing references these keys, so widening them
-- breaks no foreign key.
--
-- design_settings needs no new column: its primary key is already a text `id` that has only ever
-- held 'default', so a brand id drops straight in.

begin;

-- ── the new column ────────────────────────────────────────────────────────────────────────
alter table generation_rules   add column if not exists brand text not null default 'superba';
alter table layout_settings    add column if not exists brand text not null default 'superba';
alter table photo_settings     add column if not exists brand text not null default 'superba';
alter table custom_slides      add column if not exists brand text not null default 'superba';
alter table custom_slide_files add column if not exists brand text not null default 'superba';
alter table custom_photos      add column if not exists brand text not null default 'superba';
alter table layout_overrides   add column if not exists brand text not null default 'superba';

-- ── widen the keys that assumed a single brand ────────────────────────────────────────────
-- Column names differ per table (layout / photo_id / layout), so each is spelled out rather
-- than looped: getting one wrong would silently leave that table single-brand.
alter table layout_settings  drop constraint if exists layout_settings_pkey;
alter table layout_settings  add  constraint layout_settings_pkey  primary key (brand, layout);

alter table photo_settings   drop constraint if exists photo_settings_pkey;
alter table photo_settings   add  constraint photo_settings_pkey   primary key (brand, photo_id);

alter table layout_overrides drop constraint if exists layout_overrides_pkey;
alter table layout_overrides add  constraint layout_overrides_pkey primary key (brand, layout);

-- ── read paths for the tables queried by brand ────────────────────────────────────────────
create index if not exists generation_rules_brand_idx on generation_rules (brand);
create index if not exists custom_slides_brand_idx    on custom_slides (brand);
create index if not exists custom_photos_brand_idx    on custom_photos (brand);

-- design_settings: the single existing row is renamed from 'default' to 'superba' so the column
-- means exactly one thing (a brand) rather than two.
update design_settings set id = 'superba' where id = 'default';

commit;
