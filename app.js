// app.js - MPN Search Sidecar for Shopify
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

// Import modules
const DatabaseManager = require('./database/setup');
const ShopifyGraphQLService = require('./services/shopifyGraphQL');

const app = express();

// Initialize services
let db = null;
let shopifyService = null;

async function initializeServices() {
  try {
    // Initialize database
    console.log('🗄️ Initializing SQLite database...');
    db = new DatabaseManager();
    await db.initialize();
    console.log('✅ Database ready');

    // Initialize Shopify service (if credentials available)
    const shop = process.env.SHOPIFY_SHOP;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (shop && accessToken) {
      shopifyService = new ShopifyGraphQLService(shop, accessToken);
      console.log(`✅ Shopify service initialized for ${shop}`);
    } else {
      console.log('⚠️ Shopify credentials not configured - sync disabled');
    }

    // Pass dependencies to routes
    const searchRoutes = require('./routes/search');
    const syncRoutes = require('./routes/sync');

    if (searchRoutes.setDatabase) {
      searchRoutes.setDatabase(db);
    }

    if (syncRoutes.setDatabase) {
      syncRoutes.setDatabase(db);
    }

    if (syncRoutes.setShopifyService && shopifyService) {
      syncRoutes.setShopifyService(shopifyService);
    }

    return true;

  } catch (error) {
    console.error('❌ Service initialization failed:', error);
    return false;
  }
}

// ========== MIDDLEWARE ==========

// Security (configured for embedded app + cross-origin search)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.shopify.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      frameAncestors: ["https://*.myshopify.com", "https://admin.shopify.com"],
    },
  },
  frameguard: false,
}));

// CORS for storefront search requests
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc)
    if (!origin) return callback(null, true);
    
    // Allow configured origins
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow any *.myshopify.com origin
    if (origin.endsWith('.myshopify.com')) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Rate limiting for search endpoint (generous for autocomplete)
const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  message: { error: 'Too many requests' }
});

// Rate limiting for sync endpoints (restrictive)
const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many sync requests' }
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'frontend', 'dist')));

// ========== ROUTES ==========

// Search API (the sidecar endpoint)
app.use('/api/search', searchLimiter, require('./routes/search'));

// Sync API (admin only)
app.use('/api/sync', syncLimiter, require('./routes/sync'));

// Auth (Shopify OAuth)
app.use('/api/auth', require('./routes/auth'));

// Settings API
app.get('/api/settings', async (req, res) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not available' });
  }
  
  try {
    const settings = await db.getAllSettings();
    res.json({
      metafieldNamespace: process.env.MPN_METAFIELD_NAMESPACE || 'custom',
      metafieldKey: process.env.MPN_METAFIELD_KEY || 'manufacturer_item_number',
      shop: process.env.SHOPIFY_SHOP || null,
      ...settings
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// Health check
app.get('/health', async (req, res) => {
  const stats = db ? await db.getIndexStats() : null;
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    database: db ? 'Connected' : 'Not Connected',
    shopify: shopifyService ? 'Configured' : 'Not Configured',
    index: stats
  });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dist', 'index.html'));
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(error.status || 500).json({
    error: error.message || 'Internal Server Error'
  });
});

// ========== GRACEFUL SHUTDOWN ==========

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (db) await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  if (db) await db.close();
  process.exit(0);
});

// ========== START SERVER ==========

async function startServer() {
  const PORT = process.env.PORT || 3001;

  const initialized = await initializeServices();

  app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 MPN Search Sidecar');
    console.log('='.repeat(50));
    console.log(`📱 Admin UI: http://localhost:${PORT}`);
    console.log(`🔍 Search API: http://localhost:${PORT}/api/search?q=MPN`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    
    if (initialized) {
      console.log(`🗄️ Database: SQLite (persistent)`);
      console.log(`🔗 Shopify: ${process.env.SHOPIFY_SHOP || 'Not configured'}`);
    }
    
    console.log('='.repeat(50) + '\n');
  });
}

startServer().catch(error => {
  console.error('❌ Failed to start:', error);
  process.exit(1);
});
