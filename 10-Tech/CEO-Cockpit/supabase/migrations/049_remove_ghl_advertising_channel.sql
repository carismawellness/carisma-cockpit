-- Removes GHL as a standalone advertising channel bucket.
--
-- Decision: GHL (Go High Level — CRM / automation platform) is no longer
-- tracked separately on the P&L by Venue Advertising breakdown. Any Zoho
-- contact that previously resolved to the "GHL" bucket should now fall
-- through to "Misc" under Advertising.
--
-- Mechanism: deleting these patterns means resolveAdChannel() finds no match
-- for a GHL contact and returns null, which both the API route and the
-- zoho-transactions-daily ETL bucket as "Misc". No data is lost — the spend
-- still lands on the Advertising EBITDA line, just inside Misc rather than
-- its own row. See seed in 045_advertising_contact_mapping.sql.

DELETE FROM advertising_contact_mapping
WHERE canonical = 'GHL';
