/* The platform's rate limiting binding: one count per key, per location. */
export interface RateLimitBinding {
    limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
    // The origin this service is served from, written into the style it hands out; a request's own URL is not trusted for it.
    PUBLIC_ORIGIN: string;
    // Comma separated origins besides loopback and the desktop app that may call from a page.
    ALLOWED_ORIGINS?: string;
    // The TomTom key. It is added to upstream requests here and never leaves this service.
    TOMTOM_API_KEY?: string;
    // The secret the address book signs map tickets with; at least 32 bytes in base64url.
    MAP_TICKET_SECRET?: string;
    TICKET_LIMIT?: RateLimitBinding;
}
