#!/usr/bin/env bun
/**
 * Mock OIDC Server for local testing of the Obsidian SpacetimeDB Auth flow.
 *
 * Simulates a proxy login page that redirects back to Obsidian with a token.
 * No real network/Pangolin setup needed.
 *
 * Usage:
 *   bun run test/mock-oidc-server.ts
 *
 * Then in Obsidian plugin settings:
 *   Auth Provider URL: http://localhost:9876/authorize
 *
 * Click "Login" → browser opens → auto-redirects to:
 *   obsidian://spacetime-sync-auth?token=MOCK_JWT&expires=EPOCH_MS
 */

const PORT = 9876;
const TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour

/** Create a simple mock JWT (base64 encoded, NOT cryptographically signed) */
function makeMockJwt(sub: string): string {
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const exp = Math.floor((Date.now() + TOKEN_LIFETIME_MS) / 1000);
    const payload = btoa(JSON.stringify({
        sub,
        iss: `http://localhost:${PORT}`,
        aud: 'obsidian-spacetime-sync',
        iat: Math.floor(Date.now() / 1000),
        exp,
        name: 'Test User',
        email: 'testuser@mock.local',
    }));
    return `${header}.${payload}.mock_signature`;
}

const html = (body: string) =>
    `<!DOCTYPE html><html><head>
    <title>Mock Auth Provider</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 20px; background: #0f0f13; color: #e8e8f0; }
        h1 { color: #a78bfa; } p { color: #9ca3af; }
        .badge { background: #1e1b4b; border: 1px solid #4c1d95; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; color: #a78bfa; }
        button { background: #7c3aed; color: white; border: none; padding: 10px 24px; border-radius: 6px; cursor: pointer; font-size: 1rem; margin-top: 16px; }
        button:hover { background: #6d28d9; }
        .token-box { background: #1a1a2e; border: 1px solid #2d2d5e; border-radius: 6px; padding: 12px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 0.75rem; color: #818cf8; }
    </style>
    </head><body>${body}</body></html>`;

// @ts-ignore - Bun global available at runtime
const server = Bun.serve({
    port: PORT,
    async fetch(req: Request) {
        const url = new URL(req.url);

        // ── OIDC Discovery Document ────────────────────────────────
        if (url.pathname === '/.well-known/openid-configuration') {
            return Response.json({
                issuer: `http://localhost:${PORT}`,
                authorization_endpoint: `http://localhost:${PORT}/authorize`,
                token_endpoint: `http://localhost:${PORT}/token`,
                jwks_uri: `http://localhost:${PORT}/.well-known/jwks.json`,
                response_types_supported: ['code', 'token'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['none'],
            });
        }

        // ── JWKS (mock — no real keys) ─────────────────────────────
        if (url.pathname === '/.well-known/jwks.json') {
            return Response.json({ keys: [] });
        }

        // ── Root & Authorization endpoint ──────────────────────────
        // If redirect_uri is present, we show the login page.
        // This handles both http://localhost:9876/ and http://localhost:9876/authorize
        if (url.pathname === '/' || url.pathname === '/authorize') {
            const redirectUri = url.searchParams.get('redirect_uri');

            if (redirectUri) {
                // Show mock login page
                return new Response(html(`
                    <span class="badge">Mock OIDC Server</span>
                    <h1>🔑 Login</h1>
                    <p>Simulating authentication as <strong>Test User</strong> (testuser@mock.local).</p>
                    <p>You will be automatically redirected to Obsidian in <span id="t">3</span>s…</p>
                    <button onclick="doLogin()">Login Now</button>
                    <script>
                        function doLogin() {
                            window.location.href = '/callback?redirect_uri=${encodeURIComponent(redirectUri)}';
                        }
                        let s = 3;
                        const el = document.getElementById('t');
                        const iv = setInterval(() => {
                            s--;
                            el.textContent = s;
                            if (s <= 0) { clearInterval(iv); doLogin(); }
                        }, 1000);
                    </script>
                `), { headers: { 'Content-Type': 'text/html' } });
            }

            // No redirect_uri? Show info page at root
            if (url.pathname === '/') {
                return new Response(html(`
                    <span class="badge">Mock OIDC Server</span>
                    <h1>SpacetimeDB Auth Test Server</h1>
                    <p>This server simulates an OIDC login provider for local testing.</p>
                    <p>Configure your Obsidian plugin settings with:<br>
                       <strong>Server URL:</strong> <code>http://localhost:${PORT}</code></p>
                    <p>Click the Login button in Obsidian → this server will auto-complete the auth flow
                       and redirect back to Obsidian with a test token.</p>
                `), { headers: { 'Content-Type': 'text/html' } });
            }
        }

        // ── Callback endpoint ──────────────────────────────────────
        // Generates a mock token and redirects to the obsidian:// URI.
        if (url.pathname === '/callback') {
            const redirectUri = decodeURIComponent(url.searchParams.get('redirect_uri') ?? 'obsidian://spacetime-sync-auth');
            const token = makeMockJwt('testuser');
            const expires = Date.now() + TOKEN_LIFETIME_MS;

            // Build the obsidian:// redirect
            const obsidianUri = `${redirectUri}?token=${encodeURIComponent(token)}&expires=${expires}`;

            console.log(`\n✅ Auth callback — redirecting to Obsidian`);
            console.log(`   Token: ${token.substring(0, 60)}...`);
            console.log(`   Expires: ${new Date(expires).toISOString()}`);

            // Show a confirmation page with the redirect, also attempt auto-open
            return new Response(html(`
                <span class="badge">Mock OIDC Server</span>
                <h1>✅ Authenticated!</h1>
                <p>Redirecting to Obsidian with your token…</p>
                <p>If Obsidian doesn't open automatically, click the button below or 
                   copy the token and paste it manually in Settings → Authentication.</p>
                <button onclick="window.location.href='${obsidianUri}'">Open Obsidian</button>
                <h4>Token (for manual paste):</h4>
                <div class="token-box">${token}</div>
                <script>
                    // Attempt auto-redirect  
                    setTimeout(() => { window.location.href = '${obsidianUri}'; }, 500);
                </script>
            `), { headers: { 'Content-Type': 'text/html' } });
        }

        return new Response('Not Found', { status: 404 });
    },
});

console.log(`
🚀 Mock OIDC Server running on http://localhost:${PORT}

Test setup:
  1. In Obsidian plugin settings, enable Auth and set:
       Server URL: http://localhost:${PORT}
  2. Click "Login" button in settings
  3. Browser will open → auto-redirect back to Obsidian with a token
  4. Or copy the token from the browser and paste it manually (for mobile)

Endpoints:
  GET /               Info page (if no redirect_uri)
  GET /               Login page (if redirect_uri present)
  GET /authorize      Login page (if redirect_uri present)
  GET /callback       Generates token, redirects to obsidian://spacetime-sync-auth
  GET /.well-known/openid-configuration  OIDC discovery doc

Press Ctrl+C to stop.
`);
