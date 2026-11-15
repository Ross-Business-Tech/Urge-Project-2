// Where the AI review screen sends its requests. This is the ONLY place the app is allowed to talk to, and the page's
// security policy (vite.config.js) is built from this address, so changing it changes what the browser permits.
//
// The address of a gateway is public and harmless: it refuses everyone without the access code, and the AI provider's key
// lives only on the gateway's server (see ai-gateway/README.md), never in this app.
//
//   enabled   false removes the AI review screen's ability to send anything and puts the page back to "no network at all".
//   gatewayUrl the full address of the gateway's /api/ai endpoint.
export const AI_CONFIG = {
  enabled: true,
  gatewayUrl: 'https://urge-project-2.onrender.com/api/ai',
}

// The part of the address a browser's security policy needs (scheme and host, no path).
export const gatewayOrigin = () => new URL(AI_CONFIG.gatewayUrl).origin
