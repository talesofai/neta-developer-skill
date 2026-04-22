// Central configuration for the Neta Open Platform demo SPA.
// Replace YOUR_CLIENT_ID with the CLIENT ID from the Neta Developer Portal.
//
// 1. Register a developer app (see references/developer-app-crud.md)
// 2. Copy the CLIENT ID from the portal and paste it below
export const CONFIG = {
  openPlatformEndpoint: 'https://auth.neta.art',

  clientId:             'YOUR_CLIENT_ID',

  apiResource:          'https://api.talesofai',
  apiBase:              'https://api.talesofai.com',
  llmGatewayEndpoint:   'https://litellm.talesofai.com',

  // http://localhost:9999/ works during local development.
  // When deployed, use your cohub public link as the redirect URI.
  redirectUri:          'http://localhost:9999/',

  // OAuth scopes requested during sign-in. Must match scopes registered for your app.
  scopes:               'openid offline_access user:read asset:read asset:write generate llm',
};
