# Shopify MPN Search Sidecar

A lightweight search API that enables MPN (Manufacturer Part Number) matching for Shopify's predictive search.

## The Problem

Shopify's native search doesn't index variant metafields. If you store MPNs in `custom.manufacturer_item_number`, customers can't search by MPN.

## The Solution

This sidecar API:
1. Syncs variant MPNs from Shopify to a local SQLite index
2. Provides a fast `/api/search?q=MPN` endpoint
3. Your theme calls both Shopify search AND this sidecar in parallel
4. Results are merged, with MPN matches badged as "MPN MATCH"

## Quick Start

```bash
# 1. Install backend dependencies
npm install

# 2. Install frontend dependencies
cd frontend && npm install && cd ..

# 3. Copy and configure environment
cp .env.example .env
# Edit .env with your Shopify credentials

# 4. Build frontend
cd frontend && npm run build && cd ..

# 5. Start the server
npm start
```

## Environment Variables

```env
# Shopify App Credentials
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_SCOPES=read_products

# Shop Configuration (single-tenant)
SHOPIFY_SHOP=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpat_xxxxx

# Metafield Configuration
MPN_METAFIELD_NAMESPACE=custom
MPN_METAFIELD_KEY=manufacturer_item_number

# Server
PORT=3001

# CORS - Your storefront domains
ALLOWED_ORIGINS=https://your-store.myshopify.com,https://your-store.com
```

## API Endpoints

### Search (Public)
```
GET /api/search?q=7665PP
```
Returns variants matching the MPN (normalized, exact match).

### Sync (Admin)
```
POST /api/sync/full     # Trigger full sync
GET  /api/sync/status/:id  # Check sync job status
GET  /api/sync/history     # Sync history
```

### Webhooks
```
POST /api/sync/webhook/products-update
POST /api/sync/webhook/products-delete
```

## Theme Integration

Replace the `checkMpnMatch()` stub in your theme's search file:

```javascript
async checkMpnMatch(searchTerm) {
  try {
    const normalized = searchTerm.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (normalized.length < 2) return [];
    
    const response = await fetch(
      `https://your-app.com/api/search?q=${encodeURIComponent(normalized)}`
    );
    
    if (!response.ok) return [];
    
    const matches = await response.json();
    console.log('[MPN] Sidecar returned:', matches);
    return matches;
    
  } catch (error) {
    console.error('[MPN] Sidecar error:', error);
    return [];
  }
}
```

## Search Behavior

- **Exact match only**: "T567L" matches "T567L", not "T567L9900P"
- **Normalized matching**: "7665pp", "7665-PP", and "7665 PP" all match MPN "7665-PP"
- **Normalization**: Strips non-alphanumeric characters, uppercases

## Database Schema

```sql
variant_lookups (
  variant_id TEXT UNIQUE,    -- Shopify GID
  product_id TEXT,           -- For URL construction
  product_handle TEXT,       -- For URL construction  
  product_title TEXT,        -- Display
  variant_title TEXT,        -- Display
  image_url TEXT,            -- Suggestion card image
  mpn TEXT,                  -- Original MPN value
  mpn_normalized TEXT,       -- Searchable (indexed)
  sku TEXT,
  price TEXT
)
```

## Development

```bash
# Run backend with auto-reload
npm run dev

# Run frontend dev server (with API proxy)
cd frontend && npm run dev
```

Frontend dev server runs on http://localhost:5173 with API proxied to :3001.

## Deployment

1. Deploy to Railway/Render/Fly.io
2. Set environment variables
3. Run initial sync from admin UI
4. Update theme with your deployed URL
5. Register webhooks (automatic on first sync, or via admin UI)

## License

MIT
