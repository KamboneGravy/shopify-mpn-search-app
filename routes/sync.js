// routes/sync.js - Sync Endpoints for MPN Index (Bulk Operations)
const express = require('express');
const router = express.Router();
const crypto = require('crypto');

let db = null;
let shopifyService = null;

// Inject dependencies
router.setDatabase = (database) => {
  db = database;
  console.log('✅ Database passed to sync routes');
};

router.setShopifyService = (service) => {
  shopifyService = service;
  console.log('✅ Shopify service passed to sync routes');
};

/**
 * POST /api/sync/full
 * 
 * Triggers a full sync of all variants with MPNs from Shopify.
 * Uses Bulk Operations API for large catalogs.
 * This is an async operation - returns immediately with job ID.
 */
router.post('/full', async (req, res) => {
  if (!db || !shopifyService) {
    return res.status(500).json({ error: 'Services not initialized' });
  }

  const shop = process.env.SHOPIFY_SHOP;
  
  try {
    // Create sync job record
    const { id: jobId } = await db.createSyncJob(shop, 'full');
    
    console.log(`🔄 Starting full sync job #${jobId} for ${shop}`);
    
    // Start async sync (don't await)
    runFullSync(jobId, shop).catch(error => {
      console.error(`❌ Sync job #${jobId} failed:`, error);
    });

    res.json({
      success: true,
      jobId,
      message: 'Full sync started (using Bulk Operations API)',
      statusUrl: `/api/sync/status/${jobId}`
    });

  } catch (error) {
    console.error('❌ Failed to start sync:', error);
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

/**
 * Run the full sync process using Bulk Operations
 */
async function runFullSync(jobId, shop) {
  let totalIndexed = 0;

  try {
    console.log(`📦 Job #${jobId}: Starting bulk export from Shopify...`);
    
    const metafieldNamespace = process.env.MPN_METAFIELD_NAMESPACE || 'custom';
    const metafieldKey = process.env.MPN_METAFIELD_KEY || 'manufacturer_item_number';
    
    // Use bulk operations to fetch all variants
    const variants = await shopifyService.bulkFetchVariants(
      metafieldNamespace,
      metafieldKey,
      (status, objectCount) => {
        console.log(`📊 Job #${jobId}: Bulk operation ${status}, ${objectCount} objects`);
      }
    );

    console.log(`📦 Job #${jobId}: Received ${variants.length} variants from bulk export`);

    // Clear existing index before inserting new data
    console.log(`🗑️ Job #${jobId}: Clearing existing index...`);
    await db.clearIndex();

    // Transform and bulk insert
    const transformedVariants = variants.map(v => ({
      variant_id: v.id,
      product_id: v.product.id,
      product_handle: v.product.handle,
      product_title: v.product.title,
      variant_title: v.title,
      image_url: v.image?.url || v.product.featuredImage?.url || null,
      mpn: v.mpn,
      sku: v.sku,
      price: v.price
    }));

    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < transformedVariants.length; i += batchSize) {
      const batch = transformedVariants.slice(i, i + batchSize);
      const { indexed } = await db.bulkUpsertVariants(batch);
      totalIndexed += indexed;
      
      console.log(`📦 Job #${jobId}: Inserted batch ${Math.floor(i / batchSize) + 1} (${totalIndexed}/${variants.length})`);
      
      // Update job progress
      await db.updateSyncJob(jobId, {
        processed_variants: i + batch.length,
        indexed_variants: totalIndexed
      });
    }

    // Mark job complete
    await db.completeSyncJob(jobId, 'completed', totalIndexed);
    console.log(`✅ Job #${jobId}: Full sync complete - ${totalIndexed} variants indexed`);

  } catch (error) {
    console.error(`❌ Job #${jobId}: Sync failed:`, error);
    await db.completeSyncJob(jobId, 'failed', totalIndexed, error.message);
    throw error;
  }
}

/**
 * GET /api/sync/status/:jobId
 * 
 * Get status of a sync job.
 */
router.get('/status/:jobId', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const job = await new Promise((resolve, reject) => {
      db.db.get('SELECT * FROM sync_status WHERE id = ?', [req.params.jobId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);

  } catch (error) {
    console.error('❌ Status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /api/sync/history
 * 
 * Get sync history.
 */
router.get('/history', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const shop = process.env.SHOPIFY_SHOP;
    const history = await db.getSyncHistory(shop, 20);
    res.json(history);
  } catch (error) {
    console.error('❌ History error:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * POST /api/sync/webhook/products-update
 * 
 * Webhook handler for products/update events.
 * Updates the MPN index when a product changes.
 */
router.post('/webhook/products-update', async (req, res) => {
  // Verify webhook (Shopify sends HMAC)
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');

  console.log(`📨 Webhook received: ${topic} from ${shop}`);

  // Verify HMAC
  if (!verifyWebhook(req.body, hmac)) {
    console.error('❌ Webhook HMAC verification failed');
    return res.status(401).send('Unauthorized');
  }

  // Acknowledge webhook immediately
  res.status(200).send('OK');

  // Process webhook async
  try {
    const product = req.body;
    await processProductUpdate(product);
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
  }
});

/**
 * POST /api/sync/webhook/products-delete
 * 
 * Webhook handler for products/delete events.
 */
router.post('/webhook/products-delete', async (req, res) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');

  console.log(`📨 Webhook received: ${topic} from ${shop}`);

  if (!verifyWebhook(req.body, hmac)) {
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK');

  try {
    const { id } = req.body;
    const productGid = `gid://shopify/Product/${id}`;
    
    const result = await db.deleteProductVariants(productGid);
    console.log(`🗑️ Deleted ${result.changes} variants for product ${id}`);

  } catch (error) {
    console.error('❌ Delete webhook error:', error);
  }
});

/**
 * Process a product update webhook
 */
async function processProductUpdate(product) {
  if (!db || !shopifyService) {
    console.error('❌ Services not initialized for webhook');
    return;
  }

  const productGid = `gid://shopify/Product/${product.id}`;
  
  console.log(`🔄 Processing product update: ${product.title} (${product.id})`);

  try {
    // Fetch fresh variant data with metafields from GraphQL
    const metafieldNamespace = process.env.MPN_METAFIELD_NAMESPACE || 'custom';
    const metafieldKey = process.env.MPN_METAFIELD_KEY || 'manufacturer_item_number';
    
    const variants = await shopifyService.fetchProductVariants(productGid, metafieldNamespace, metafieldKey);

    // Update index
    let updated = 0;
    let removed = 0;

    for (const variant of variants) {
      if (variant.mpn) {
        await db.upsertVariant({
          variant_id: variant.id,
          product_id: productGid,
          product_handle: product.handle,
          product_title: product.title,
          variant_title: variant.title,
          image_url: variant.image?.url || null,
          mpn: variant.mpn,
          sku: variant.sku,
          price: variant.price
        });
        updated++;
      } else {
        // Remove variant if MPN was cleared
        await db.deleteVariant(variant.id);
        removed++;
      }
    }

    console.log(`✅ Product ${product.id}: ${updated} variants updated, ${removed} removed`);

  } catch (error) {
    console.error(`❌ Failed to process product ${product.id}:`, error);
  }
}

/**
 * Verify Shopify webhook HMAC
 */
function verifyWebhook(body, hmac) {
  if (!hmac) return false;
  
  const secret = process.env.SHOPIFY_API_SECRET;
  const rawBody = typeof body === 'string' ? body : JSON.stringify(body);
  
  const calculated = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(calculated)
  );
}

/**
 * POST /api/sync/clear
 * 
 * Clear the entire MPN index.
 */
router.post('/clear', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }

  try {
    const result = await db.clearIndex();
    console.log(`🗑️ Index cleared: ${result.changes} variants removed`);
    res.json({ success: true, removed: result.changes });
  } catch (error) {
    console.error('❌ Clear index error:', error);
    res.status(500).json({ error: 'Failed to clear index' });
  }
});

module.exports = router;
