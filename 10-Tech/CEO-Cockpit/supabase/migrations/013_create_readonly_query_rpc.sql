-- Read-only query execution for CI engine
-- Runs as the calling user's role, with statement timeout and read-only transaction
CREATE OR REPLACE FUNCTION execute_readonly_query(query_text text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Enforce read-only
  SET LOCAL transaction_read_only = on;
  SET LOCAL statement_timeout = '10s';

  EXECUTE format('SELECT jsonb_agg(row_to_json(t)) FROM (%s) t', query_text) INTO result;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Only authenticated users can call this
REVOKE ALL ON FUNCTION execute_readonly_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION execute_readonly_query(text) TO authenticated;
