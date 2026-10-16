export interface Env {
    // The address book's database, which holds the nightly rollups in `usage_daily`.
    DB: D1Database;
    ACCOUNT_ID: string;
    // An API token with Account Analytics Read alone, for the Analytics Engine SQL API. Never logged.
    ANALYTICS_API_TOKEN?: string;
    // The Access team (`<team>.cloudflareaccess.com`) and the application's AUD tag; without both nothing is shown.
    ACCESS_TEAM_DOMAIN?: string;
    ACCESS_AUD?: string;
    // The one person the dashboard is for.
    ACCESS_EMAIL: string;
}
