/**
 * Pagination helper for Supabase PostgREST queries.
 *
 * PostgREST silently truncates results at the server's max_rows setting
 * (default 1000) with no error or warning. Any query that might return
 * more than 1000 rows MUST use this helper instead of a bare .select().
 *
 * Usage:
 *   const rows = await fetchAll<MyType>(
 *     (off, lim) =>
 *       supabase.from("my_table")
 *         .select("col1, col2")
 *         .gte("date", from)
 *         .lte("date", to)
 *         .range(off, off + lim - 1),
 *     "my_table",
 *   );
 */
export async function fetchAll<T>(
  queryFactory: (
    offset: number,
    limit: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label = "fetchAll",
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await queryFactory(offset, pageSize);
    if (error) throw new Error(`${label} (offset ${offset}): ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
  }
  return all;
}
