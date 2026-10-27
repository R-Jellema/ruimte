-- The model catalogs, a row per model so a person manages them in D1 itself. `scripts/seed-model-catalog.ts` fills a
-- kind from the manifest once; after that D1 is where a catalog changes, and the Worker answers it over the bundled one.
CREATE TABLE model_catalogs (
    kind TEXT PRIMARY KEY,
    default_model TEXT NOT NULL,
    -- Set by the triggers below, so a machine takes an edit made by hand without a date typed with it.
    updated_at TEXT NOT NULL
);

-- What a model can be asked for. Both columns are JSON, as `ModelCatalogProfileSchema` has them.
CREATE TABLE model_catalog_profiles (
    kind TEXT NOT NULL REFERENCES model_catalogs (kind) ON DELETE CASCADE,
    name TEXT NOT NULL,
    options TEXT NOT NULL DEFAULT '[]',
    context_window_tokens TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (kind, name)
);

-- The models of a kind in the order the picker lists them. `aliases` is a JSON array; `tools` is null when unknown.
CREATE TABLE model_catalog_models (
    kind TEXT NOT NULL REFERENCES model_catalogs (kind) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    profile TEXT NOT NULL,
    badge TEXT,
    vendor TEXT,
    aliases TEXT,
    legacy INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0, 1)),
    min_cli_version TEXT,
    tools INTEGER CHECK (tools IN (0, 1)),
    PRIMARY KEY (kind, slug)
);

CREATE TRIGGER model_catalogs_default_changed AFTER UPDATE OF default_model ON model_catalogs
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = NEW.kind;
END;

CREATE TRIGGER model_catalog_models_inserted AFTER INSERT ON model_catalog_models
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = NEW.kind;
END;

CREATE TRIGGER model_catalog_models_updated AFTER UPDATE ON model_catalog_models
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind IN (OLD.kind, NEW.kind);
END;

CREATE TRIGGER model_catalog_models_deleted AFTER DELETE ON model_catalog_models
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = OLD.kind;
END;

CREATE TRIGGER model_catalog_profiles_inserted AFTER INSERT ON model_catalog_profiles
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = NEW.kind;
END;

CREATE TRIGGER model_catalog_profiles_updated AFTER UPDATE ON model_catalog_profiles
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind IN (OLD.kind, NEW.kind);
END;

CREATE TRIGGER model_catalog_profiles_deleted AFTER DELETE ON model_catalog_profiles
BEGIN
    UPDATE model_catalogs SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE kind = OLD.kind;
END;
