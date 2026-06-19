/** Individual campaign performance */
export interface KlaviyoCampaignData {
  id: string;
  name: string;
  sentDate: string;
  recipients: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  bounceRate: number;
  clicks: number;
  opensUnique: number;
}

/** Individual flow performance */
export interface KlaviyoFlowData {
  id: string;
  name: string;
  status: string;
  triggerType: string;
  recipients: number;
  delivered: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  bounceRate: number;
  clicks: number;
  opensUnique: number;
}

/** Aggregated overview */
export interface KlaviyoOverview {
  totalSubscribers: number;
  overallOpenRate: number;
  overallClickRate: number;
  overallUnsubscribeRate: number;
  overallBounceRate: number;
  totalRecipients: number;
  totalDelivered: number;
  totalCampaignsSent: number;
  totalActiveFlows: number;
}

/** Response shape from /api/email/klaviyo */
export interface KlaviyoApiResponse {
  campaigns: KlaviyoCampaignData[];
  flows: KlaviyoFlowData[];
  overview: KlaviyoOverview;
  error?: string;
  tokenMissing?: boolean;
}
