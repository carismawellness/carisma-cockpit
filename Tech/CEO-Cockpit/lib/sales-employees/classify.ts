// Aesthetics service-vs-retail classifier.
//
// aesthetics_sales_daily does not flag retail rows — the Service/Products
// column mixes treatments ("Botox 3 areas") and products ("Obagi Vit C Serum").
// Keyword classifier, case-insensitive; anything not matched is a SERVICE
// (treatments dominate the sheet, so service is the safe default).

const RETAIL_PATTERNS: RegExp[] = [
  /\bcream\b/i,
  /\bserum\b/i,
  /\bskincare\b/i,
  /\bskin care\b/i,
  /\bspf\b/i,
  /\bsunscreen\b/i,
  /\bsun screen\b/i,
  /\bcleanser\b/i,
  /\bmoisturiser\b/i,
  /\bmoisturizer\b/i,
  /\bmask kit\b/i,
  /\bhome care\b/i,
  /\bhomecare\b/i,
  /\bretail\b/i,
  /\bproduct\b/i,
  /\bkit\b/i,
  /\blotion\b/i,
  /\btoner\b/i,
  /\bgel\b(?!\s*(nail|polish))/i,
  /\bshampoo\b/i,
  /\bsupplement\b/i,
  /\bvoucher\b/i,
];

/** true when the Aesthetics Service/Products value looks like a retail product. */
export function isAestheticsRetail(serviceProduct: string | null | undefined): boolean {
  const text = (serviceProduct ?? "").trim();
  if (!text) return false; // default = service
  return RETAIL_PATTERNS.some((re) => re.test(text));
}
