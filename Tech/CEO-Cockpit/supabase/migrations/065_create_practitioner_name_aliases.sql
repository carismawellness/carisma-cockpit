-- Manual overrides when revenue-source names don't match canonical employee names
-- (e.g. "BLERINA" in Spa sheet → "Blerina Petani" in Zoho wages)
-- venue: "spa" | "aesthetics" | "slimming"
CREATE TABLE IF NOT EXISTS practitioner_name_aliases (
    revenue_name   TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    venue          TEXT NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (revenue_name, venue)
);
