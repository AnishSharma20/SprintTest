-- Align categories to match the PPTX benefit grid.
-- Replace the old topic-based categories with the benefit-focused ones shown in the Superba deck.

-- Delete old categories to replace them
DELETE FROM categories WHERE parent = 'science';

-- Insert the new benefit categories matching the PPTX grid
INSERT INTO categories (id, parent, name, sort_order) VALUES
  ('wellness_immune',       'science', 'Wellness & Immune Support',     1),
  ('heart',                 'science', 'Heart Support',                 2),
  ('liver',                 'science', 'Liver Support',                 3),
  ('joints',                'science', 'Joint Support',                 4),
  ('healthy_aging',         'science', 'Healthy Aging Support',         5),
  ('brain_eye',             'science', 'Brain & Dry Eye Support',       6),
  ('pms',                   'science', 'PMS Support',                   7),
  ('skin',                  'science', 'Skin Support',                  8),
  ('sports_performance',    'science', 'Sports Performance Support',    9),
  ('weight_loss',           'science', 'Weight Loss Support',          10),
  ('mechanism',             'science', 'Mechanism of Action',          11),
  ('absorption',            'science', 'Bioavailability & Absorption', 12),
  ('safety_dosage',         'science', 'Safety & Dosage',              13),
  ('other_science',         'science', 'Other Science',                14);

-- Marketing categories remain unchanged from the original migration
