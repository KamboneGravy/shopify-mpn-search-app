// routes/auth.js - Shopify OAuth for Embedded App
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES || 'read_products';
const SHOPIFY_HOST = process.env.SHOPIFY_HOST;

// Store sessions (in production, use database)
const sessions = new Map();

// Step 1: Redirect to Shopify OAuth
router.get('/', (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('Missing shop parameter');
  }
  
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${SHOPIFY_HOST}/api/auth/callback`;
  
  // Store state for verification
  sessions.set(state, { shop, timestamp: Date.now() });
  
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;
  
  console.log('🔐 Redirecting to Shopify OAuth:', authUrl);
  res.redirect(authUrl);
});

// Step 2: Handle OAuth callback
router.get('/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;
  
  console.log('🔐 OAuth callback received:', { shop, state, hasCode: !!code });
  
  // Verify state
  const storedSession = sessions.get(state);
  if (!storedSession || storedSession.shop !== shop) {
    return res.status(403).send('Invalid state parameter');
  }
  sessions.delete(state);
  
  // Verify HMAC
  const queryParams = { ...req.query };
  delete queryParams.hmac;
  const message = Object.keys(queryParams)
    .sort()
    .map(key => `${key}=${queryParams[key]}`)
    .join('&');
  
  const expectedHmac = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(message)
    .digest('hex');
  
  if (hmac !== expectedHmac) {
    console.error('❌ HMAC verification failed');
    return res.status(403).send('HMAC verification failed');
  }
  
  // Exchange code for access token
  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code
      })
    });
    
    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      throw new Error('No access token received');
    }
    
    console.log('✅ OAuth successful for shop:', shop);
    
    // Store the session
    sessions.set(shop, {
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      timestamp: Date.now()
    });
    
    // Redirect to the embedded app
    res.redirect(`https://${shop}/admin/apps/${SHOPIFY_API_KEY}`);
    
  } catch (error) {
    console.error('❌ Token exchange failed:', error);
    res.status(500).send('Failed to complete OAuth');
  }
});

// Get session for a shop
router.getSession = (shop) => sessions.get(shop);

// Set session (for using env-based token)
router.setSession = (shop, accessToken) => {
  sessions.set(shop, {
    accessToken,
    scope: process.env.SHOPIFY_SCOPES,
    timestamp: Date.now()
  });
};

module.exports = router;
