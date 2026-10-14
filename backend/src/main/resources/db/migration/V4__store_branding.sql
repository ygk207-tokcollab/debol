-- V4: the shop trades as Debol.
--
-- The storefront name and tagline are configuration rows, not code, so the rebrand is an UPDATE
-- rather than a schema change. Existing orders keep their own snapshots and nothing is dropped.

UPDATE store_settings
SET store_name_en = 'Debol',
    tagline_en = 'Children''s clothing, shoes and toys, delivered across Ethiopia'
WHERE id = 1;
