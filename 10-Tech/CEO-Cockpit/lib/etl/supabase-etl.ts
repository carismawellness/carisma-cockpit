function sbUrl(table: string): string {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/rest/v1/${table}`;
}

function sbHeaders(): Record<string, string> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    "Content-Type":  "application/json",
  };
}

export async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<number> {
  if (!rows.length) return 0;
  const resp = await fetch(`${sbUrl(table)}?on_conflict=${onConflict}`, {
    method:  "POST",
    headers: { ...sbHeaders(), Prefer: "return=representation,resolution=merge-duplicates" },
    body:    JSON.stringify(rows),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase upsert ${table} failed ${resp.status}: ${text}`);
  }
  const data = await resp.json() as unknown[];
  return data.length;
}

export async function select(
  table: string,
  filters?: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters ?? {})) qs.append(k, `eq.${v}`);
  const url  = qs.size ? `${sbUrl(table)}?${qs}` : sbUrl(table);
  const resp = await fetch(url, { headers: sbHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase select ${table} failed ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<Record<string, unknown>[]>;
}

// Used when the same query key appears multiple times (e.g. spa_slug=in.(a,b))
// or when you need Supabase-specific filter syntax beyond simple eq.
export async function selectRaw(
  table: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const qs   = new URLSearchParams(params);
  const resp = await fetch(`${sbUrl(table)}?${qs}`, { headers: sbHeaders() });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase selectRaw ${table} failed ${resp.status}: ${text}`);
  }
  return resp.json() as Promise<Record<string, unknown>[]>;
}

// Like deleteWhere but accepts raw PostgREST filter values (e.g. "gte.2026-01-01").
// Pass an array of [key, value] pairs to allow duplicate keys.
export async function deleteRange(
  table: string,
  params: [string, string][],
): Promise<void> {
  const qs   = new URLSearchParams(params);
  const resp = await fetch(`${sbUrl(table)}?${qs}`, {
    method:  "DELETE",
    headers: sbHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase deleteRange ${table} failed ${resp.status}: ${text}`);
  }
}

export async function deleteWhere(
  table: string,
  params: Record<string, string>,
): Promise<void> {
  const qs   = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, `eq.${v}`]));
  const resp = await fetch(`${sbUrl(table)}?${qs}`, {
    method:  "DELETE",
    headers: sbHeaders(),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase delete ${table} failed ${resp.status}: ${text}`);
  }
}

export async function insertRows(
  table: string,
  rows: Record<string, unknown>[],
): Promise<number> {
  if (!rows.length) return 0;
  const CHUNK = 200;
  let total   = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const resp = await fetch(sbUrl(table), {
      method:  "POST",
      headers: { ...sbHeaders(), Prefer: "return=minimal" },
      body:    JSON.stringify(rows.slice(i, i + CHUNK)),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Supabase insert ${table} failed ${resp.status}: ${text}`);
    }
    total += Math.min(CHUNK, rows.length - i);
  }
  return total;
}
