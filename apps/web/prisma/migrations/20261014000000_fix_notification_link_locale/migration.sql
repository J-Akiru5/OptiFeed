-- One-off, additive-safe data fix for task 5.1 (N13).
-- Notification creators used to store linkTo with a hardcoded /en prefix.
-- New creators store locale-free paths ("/dashboard/..."); the UI resolves
-- the locale. This UPDATE strips the leading /en from existing rows only —
-- no rows are deleted or inserted.
--
-- Idempotent: after the first run no row matches the LIKE pattern.
UPDATE "Notification"
SET "linkTo" = substring("linkTo" FROM 4)
WHERE "linkTo" LIKE '/en/%';
