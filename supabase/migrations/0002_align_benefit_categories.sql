-- Align science categories to the PPTX benefit grid ("Heart Support", "PMS Support", ...).
-- Data-safe: existing claims reference these ids via FK, so ids are renamed/remapped in
-- place rather than deleted-and-reinserted (a bare DELETE would violate claims_category_id_fkey).

-- 1) Rename kept categories to their benefit-grid names.
UPDATE categories SET name = 'Heart Support',                 sort_order = 2  WHERE id = 'heart';
UPDATE categories SET name = 'Joint Support',                 sort_order = 4  WHERE id = 'joints';
UPDATE categories SET name = 'Mechanism of Action',           sort_order = 11 WHERE id = 'mechanism';
UPDATE categories SET name = 'Bioavailability & Absorption',  sort_order = 12 WHERE id = 'absorption';
UPDATE categories SET name = 'Safety & Dosage',               sort_order = 13 WHERE id = 'safety_dosage';
UPDATE categories SET name = 'Other Science',                 sort_order = 14 WHERE id = 'other_science';

-- 2) Add the benefit categories that did not exist before.
INSERT INTO categories (id, parent, name, sort_order) VALUES
  ('wellness_immune',    'science', 'Wellness & Immune Support',  1),
  ('liver',              'science', 'Liver Support',              3),
  ('healthy_aging',      'science', 'Healthy Aging Support',      5),
  ('brain_eye',          'science', 'Brain & Dry Eye Support',    6),
  ('pms',                'science', 'PMS Support',                7),
  ('skin',               'science', 'Skin Support',               8),
  ('sports_performance', 'science', 'Sports Performance Support', 9),
  ('weight_loss',        'science', 'Weight Loss Support',       10)
ON CONFLICT (id) DO NOTHING;

-- 3) Remap claims off the retired categories, then remove them.
UPDATE claims SET category_id = 'brain_eye'          WHERE category_id IN ('brain', 'eye');
UPDATE claims SET category_id = 'sports_performance' WHERE category_id = 'muscle';
UPDATE claims SET category_id = 'weight_loss'        WHERE category_id = 'metabolism';

DELETE FROM categories WHERE id IN ('brain', 'eye', 'muscle', 'metabolism');

-- Marketing categories are unchanged.
