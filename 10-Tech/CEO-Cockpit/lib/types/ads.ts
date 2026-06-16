/** Campaign-level data shape used across all marketing dashboard pages */
export interface CampaignData {
  campaign: string;
  campaignId: string;
  cpl: number;
  totalSpend: number;
  totalLeads: number;
  /** Total ad clicks for this campaign in the period — used to compute CPC */
  clicks: number;
  ctr: number;
  cpm: number;
  frequency: number;
  attributedRevenue: number;
  peakCtr: number;
}

/** Response shape from /api/ads/meta and /api/ads/google */
export interface AdsApiResponse {
  campaigns: CampaignData[];
  totals: {
    spend: number;
    leads: number;
    impressions: number;
    clicks: number;
    revenue: number;
  };
  error?: string;
  tokenExpired?: boolean;
}

/** Brand slug used in API calls */
export type BrandSlug = "spa" | "aesthetics" | "slimming";

/** Meta Ads account mapping */
export const META_AD_ACCOUNTS: Record<BrandSlug, string> = {
  spa: "act_654279452039150",
  aesthetics: "act_382359687910745",
  slimming: "act_1496776195316716",
};

/** Google Ads customer IDs (to be filled after authentication) */
export const GOOGLE_ADS_CUSTOMERS: Record<BrandSlug, string> = {
  spa: process.env.GOOGLE_ADS_SPA_CUSTOMER_ID ?? "",
  aesthetics: process.env.GOOGLE_ADS_AES_CUSTOMER_ID ?? "",
  slimming: process.env.GOOGLE_ADS_SLIM_CUSTOMER_ID ?? "",
};
