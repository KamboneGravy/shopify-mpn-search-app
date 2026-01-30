// routes/search.js - MPN Search Endpoint (The Sidecar)
const express = require('express');
const router = express.Router();

let db = null;

// Inject database
router.setDatabase = (database) => {
  db = database;
  console.log('✅ Database passed to search routes');
};

/**
 * GET /api/search?q=7665PP
 * 
 * The main search endpoint called by the storefront.
 * Returns variants matching the MPN exactly (after normalization).
 * 
 * Response format matches what header-tas.liquid expects:
 * [
 *   {
 *     "productHandle": "acme-acrylic-paint-cadmium-red",
 *     "variantId": "gid://shopify/ProductVariant/12345",
 *     "productTitle": "Acme Acrylic Paint",
 *     "variantTitle": "Cadmium Red / 8oz",
 *     "mpn": "7665-PP",
 *     "sku": "ACM-7665-PP",
 *     "image": "https://cdn.shopify.com/...",
 *     "price": "12.99"
 *   }
 * ]
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { q, limit = 10 } = req.query;

  // Validate input
  if (!q || q.trim().length < 2) {
    return res.json([]);
  }

  if (!db) {
    console.error('❌ Database not initialized');
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const results = await db.searchByMpn(q.trim(), parseInt(limit, 10));
    
    // Transform to frontend-expected format
    const matches = results.map(row => ({
      productHandle: row.product_handle,
      variantId: row.variant_id,
      productTitle: row.product_title,
      variantTitle: row.variant_title,
      mpn: row.mpn,
      sku: row.sku,
      image: row.image_url,
      price: row.price
    }));

    const elapsed = Date.now() - startTime;
    console.log(`🔍 MPN search "${q}" -> ${matches.length} results (${elapsed}ms)`);

    res.json(matches);

  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/search/stats
 * 
 * Returns index statistics for the dashboard.
 */
router.get('/stats', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const stats = await db.getIndexStats();
    res.json(stats);
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/search/test/:mpn
 * 
 * Test endpoint for debugging - shows raw search results.
 */
router.get('/test/:mpn', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  const { mpn } = req.params;
  const normalized = db.normalizeMpn(mpn);

  try {
    const results = await db.searchByMpn(mpn, 20);
    
    res.json({
      query: mpn,
      normalized,
      resultCount: results.length,
      results
    });
  } catch (error) {
    console.error('❌ Test search error:', error);
    res.status(500).json({ error: 'Test search failed' });
  }
});

module.exports = router;
