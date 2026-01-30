// database/setup.js - SQLite Database for MPN Search Index
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'mpn_search.db');
    this.db = null;
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          console.error('❌ Failed to connect to SQLite database:', err.message);
          reject(err);
        } else {
          console.log('✅ Connected to SQLite database:', this.dbPath);
          this.createTables()
            .then(() => this.runMigrations())
            .then(() => {
              console.log('✅ Database tables initialized');
              resolve();
            })
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
    return new Promise((resolve, reject) => {
      const sql = `
        -- Variant Lookups Table (MPN search index)
        CREATE TABLE IF NOT EXISTS variant_lookups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          variant_id TEXT NOT NULL UNIQUE,
          product_id TEXT NOT NULL,
          product_handle TEXT NOT NULL,
          product_title TEXT NOT NULL,
          variant_title TEXT,
          image_url TEXT,
          mpn TEXT,
          mpn_normalized TEXT,
          sku TEXT,
          price TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Sync Status Table (track sync jobs)
        CREATE TABLE IF NOT EXISTS sync_status (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shop TEXT NOT NULL,
          sync_type TEXT NOT NULL,
          status TEXT NOT NULL,
          total_variants INTEGER DEFAULT 0,
          processed_variants INTEGER DEFAULT 0,
          indexed_variants INTEGER DEFAULT 0,
          error_message TEXT,
          started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME
        );

        -- Settings Table
        CREATE TABLE IF NOT EXISTS settings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          setting_key TEXT NOT NULL UNIQUE,
          setting_value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Indexes for fast MPN lookup
        CREATE INDEX IF NOT EXISTS idx_variant_lookups_mpn ON variant_lookups(mpn);
        CREATE INDEX IF NOT EXISTS idx_variant_lookups_mpn_normalized ON variant_lookups(mpn_normalized);
        CREATE INDEX IF NOT EXISTS idx_variant_lookups_product_id ON variant_lookups(product_id);
        CREATE INDEX IF NOT EXISTS idx_variant_lookups_sku ON variant_lookups(sku);
        CREATE INDEX IF NOT EXISTS idx_sync_status_shop ON sync_status(shop);
      `;

      this.db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async runMigrations() {
    console.log('🔄 Running database migrations...');
    // Future migrations go here
    console.log('✅ All migrations completed');
  }

  // ========== MPN NORMALIZATION ==========
  
  /**
   * Normalize MPN for search matching
   * Strips all non-alphanumeric characters and uppercases
   * "7665-PP" -> "7665PP"
   * "ABC 123-X" -> "ABC123X"
   */
  normalizeMpn(mpn) {
    if (!mpn) return null;
    return mpn.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  }

  // ========== VARIANT LOOKUPS (MPN INDEX) ==========

  /**
   * Upsert a variant into the search index
   */
  async upsertVariant(variant) {
    const {
      variant_id,
      product_id,
      product_handle,
      product_title,
      variant_title,
      image_url,
      mpn,
      sku,
      price
    } = variant;

    const mpn_normalized = this.normalizeMpn(mpn);

    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO variant_lookups 
          (variant_id, product_id, product_handle, product_title, variant_title, image_url, mpn, mpn_normalized, sku, price, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(variant_id) DO UPDATE SET
          product_id = excluded.product_id,
          product_handle = excluded.product_handle,
          product_title = excluded.product_title,
          variant_title = excluded.variant_title,
          image_url = excluded.image_url,
          mpn = excluded.mpn,
          mpn_normalized = excluded.mpn_normalized,
          sku = excluded.sku,
          price = excluded.price,
          updated_at = CURRENT_TIMESTAMP
      `, [variant_id, product_id, product_handle, product_title, variant_title, image_url, mpn, mpn_normalized, sku, price],
      function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
      });
    });
  }

  /**
   * Bulk upsert variants (for initial sync)
   */
  async bulkUpsertVariants(variants) {
    let indexed = 0;
    let skipped = 0;

    for (const variant of variants) {
      // Only index variants that have an MPN
      if (variant.mpn) {
        await this.upsertVariant(variant);
        indexed++;
      } else {
        skipped++;
      }
    }

    return { indexed, skipped };
  }

  /**
   * Search by MPN (exact match on normalized value)
   */
  async searchByMpn(searchTerm, limit = 10) {
    const normalized = this.normalizeMpn(searchTerm);
    
    if (!normalized || normalized.length < 2) {
      return [];
    }

    return new Promise((resolve, reject) => {
      // Exact match on normalized MPN
      this.db.all(`
        SELECT 
          variant_id,
          product_id,
          product_handle,
          product_title,
          variant_title,
          image_url,
          mpn,
          sku,
          price
        FROM variant_lookups
        WHERE mpn_normalized = ?
        LIMIT ?
      `, [normalized, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * Delete a variant from the index
   */
  async deleteVariant(variantId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM variant_lookups WHERE variant_id = ?',
        [variantId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Delete all variants for a product
   */
  async deleteProductVariants(productId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM variant_lookups WHERE product_id = ?',
        [productId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  /**
   * Clear entire index (for full resync)
   */
  async clearIndex() {
    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM variant_lookups', function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  }

  /**
   * Get index statistics
   */
  async getIndexStats() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT 
          COUNT(*) as total_variants,
          COUNT(DISTINCT product_id) as total_products,
          COUNT(mpn) as variants_with_mpn,
          MAX(updated_at) as last_updated
        FROM variant_lookups
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row || { total_variants: 0, total_products: 0, variants_with_mpn: 0 });
      });
    });
  }

  // ========== SYNC STATUS ==========

  async createSyncJob(shop, syncType) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO sync_status (shop, sync_type, status)
        VALUES (?, ?, 'running')
      `, [shop, syncType], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  }

  async updateSyncJob(id, updates) {
    const fields = [];
    const values = [];

    for (const [key, value] of Object.entries(updates)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }

    values.push(id);

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE sync_status SET ${fields.join(', ')} WHERE id = ?`,
        values,
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  async completeSyncJob(id, status, indexedVariants, errorMessage = null) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE sync_status 
        SET status = ?, indexed_variants = ?, error_message = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [status, indexedVariants, errorMessage, id], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  }

  async getLatestSyncStatus(shop) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT * FROM sync_status 
        WHERE shop = ? 
        ORDER BY started_at DESC 
        LIMIT 1
      `, [shop], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async getSyncHistory(shop, limit = 10) {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT * FROM sync_status 
        WHERE shop = ? 
        ORDER BY started_at DESC 
        LIMIT ?
      `, [shop, limit], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  // ========== SETTINGS ==========

  async getSetting(key) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT setting_value FROM settings WHERE setting_key = ?',
        [key],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? JSON.parse(row.setting_value) : null);
        }
      );
    });
  }

  async setSetting(key, value) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(setting_key) DO UPDATE SET
          setting_value = excluded.setting_value,
          updated_at = CURRENT_TIMESTAMP
      `, [key, JSON.stringify(value)], function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes });
      });
    });
  }

  async getAllSettings() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM settings', (err, rows) => {
        if (err) reject(err);
        else {
          const settings = {};
          (rows || []).forEach(row => {
            settings[row.setting_key] = JSON.parse(row.setting_value);
          });
          resolve(settings);
        }
      });
    });
  }

  // ========== CLEANUP ==========

  async close() {
    return new Promise((resolve) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) console.error('Error closing database:', err);
          else console.log('✅ Database connection closed');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = DatabaseManager;
