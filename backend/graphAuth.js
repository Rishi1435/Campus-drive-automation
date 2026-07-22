const crypto = require('crypto');
const msal = require('@azure/msal-node');
const config = require('./config');
const kv = require('./kvstore');

const TOKEN_KEY = 'graph_token_cache';

// ---------------------------------------------------------------------------
// Encrypted token cache. MSAL stores refresh/access tokens; we persist them to
// disk but encrypt at rest with AES-256-GCM so a leaked file is useless without
// APP_SECRET_KEY. This is what lets the server auth ONCE (device code) and then
// silently refresh forever without you re-signing in.
// ---------------------------------------------------------------------------
function key32() {
  if (!config.secretKey) {
    throw new Error('APP_SECRET_KEY is not set — cannot encrypt token cache. Set it in .env');
  }
  return crypto.createHash('sha256').update(config.secretKey).digest();
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(b64) {
  const raw = Buffer.from(b64, 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key32(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

const cachePlugin = {
  beforeCacheAccess: async (ctx) => {
    const stored = await kv.get(TOKEN_KEY);
    if (stored) {
      try {
        ctx.tokenCache.deserialize(decrypt(stored));
      } catch (e) {
        console.error('Could not decrypt token cache (wrong APP_SECRET_KEY?). Re-auth needed.');
      }
    }
  },
  afterCacheAccess: async (ctx) => {
    if (ctx.cacheHasChanged) {
      await kv.set(TOKEN_KEY, encrypt(ctx.tokenCache.serialize()));
    }
  },
};

// Lazily build the MSAL client so requiring this module never crashes when
// MS_CLIENT_ID isn't configured yet.
let pca;
function client() {
  if (!config.graph.clientId) {
    throw new Error(
      'MS_CLIENT_ID is not set. Complete the Azure app registration (DEPLOY.md §1) ' +
        'and add MS_CLIENT_ID to your .env.'
    );
  }
  if (!pca) {
    pca = new msal.PublicClientApplication({
      auth: { clientId: config.graph.clientId, authority: config.graph.authority },
      cache: { cachePlugin },
    });
  }
  return pca;
}

// Returns a valid access token, refreshing silently. Only prompts a device-code
// login the very first time (or if the refresh token was revoked).
async function getAccessToken() {
  const pca = client();
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (accounts.length) {
    try {
      const res = await pca.acquireTokenSilent({
        account: accounts[0],
        scopes: config.graph.scopes,
      });
      return res.accessToken;
    } catch (e) {
      console.warn('Silent token refresh failed, falling back to device-code login.');
    }
  }

  const res = await pca.acquireTokenByDeviceCode({
    scopes: config.graph.scopes,
    deviceCodeCallback: (info) => {
      console.log('\n=== MICROSOFT SIGN-IN REQUIRED (one time) ===');
      console.log(info.message); // "Go to https://microsoft.com/devicelogin and enter code XXXX"
      console.log('=============================================\n');
    },
  });
  return res.accessToken;
}

module.exports = { getAccessToken };
