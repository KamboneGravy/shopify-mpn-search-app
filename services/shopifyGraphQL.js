// services/shopifyGraphQL.js - Shopify GraphQL Client with Bulk Operations
const SHOPIFY_API_VERSION = '2024-01';

class ShopifyGraphQLService {
  constructor(shop, accessToken) {
    this.shop = shop;
    this.accessToken = accessToken;
    this.endpoint = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  }

  /**
   * Execute a GraphQL query
   */
  async query(graphqlQuery, variables = {}) {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
      },
      body: JSON.stringify({
        query: graphqlQuery,
        variables
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GraphQL request failed: ${response.status} - ${text}`);
    }

    const json = await response.json();
    
    if (json.errors) {
      console.error('GraphQL errors:', json.errors);
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  }

  /**
   * Start a bulk operation to fetch all products with variants and MPN metafield
   * Returns the bulk operation ID
   */
  async startBulkExport(namespace, key) {
    const bulkQuery = `
      {
        products {
          edges {
            node {
              id
              title
              handle
              featuredImage {
                url
              }
              variants {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    image {
                      url
                    }
                    metafield(namespace: "${namespace}", key: "${key}") {
                      value
                    }
                  }
                }
              }
            }
          }
        }
      }
    `;

    const mutation = `
      mutation BulkOperationRunQuery($query: String!) {
        bulkOperationRunQuery(query: $query) {
          bulkOperation {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.query(mutation, { query: bulkQuery });
    
    if (data.bulkOperationRunQuery.userErrors?.length > 0) {
      throw new Error(`Bulk operation errors: ${JSON.stringify(data.bulkOperationRunQuery.userErrors)}`);
    }

    const bulkOp = data.bulkOperationRunQuery.bulkOperation;
    console.log(`📦 Bulk operation started: ${bulkOp.id} (${bulkOp.status})`);
    
    return bulkOp.id;
  }

  /**
   * Poll for bulk operation completion
   * Returns the download URL when ready
   */
  async pollBulkOperation(bulkOperationId, onProgress) {
    const query = `
      query BulkOperationStatus($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            errorCode
            objectCount
            fileSize
            url
            partialDataUrl
          }
        }
      }
    `;

    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5 sec intervals)

    while (attempts < maxAttempts) {
      const data = await this.query(query, { id: bulkOperationId });
      const op = data.node;

      if (onProgress) {
        onProgress(op.status, op.objectCount || 0);
      }

      console.log(`📊 Bulk op status: ${op.status}, objects: ${op.objectCount || 0}`);

      if (op.status === 'COMPLETED') {
        return op.url;
      }

      if (op.status === 'FAILED') {
        throw new Error(`Bulk operation failed: ${op.errorCode}`);
      }

      if (op.status === 'CANCELED') {
        throw new Error('Bulk operation was canceled');
      }

      // Wait 5 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error('Bulk operation timed out');
  }

  /**
   * Download and parse the bulk operation JSONL file
   * Returns variants that have an MPN
   */
  async downloadAndParseBulkResults(url) {
    console.log(`📥 Downloading bulk results...`);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download bulk results: ${response.status}`);
    }

    const text = await response.text();
    const lines = text.trim().split('\n');
    
    console.log(`📄 Processing ${lines.length} lines...`);

    // Parse JSONL - Shopify returns parent/child relationships
    // Products come first, then their variants with __parentId
    const products = new Map();
    const variants = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      
      const obj = JSON.parse(line);
      
      if (obj.id?.includes('/Product/')) {
        // This is a product
        products.set(obj.id, {
          id: obj.id,
          title: obj.title,
          handle: obj.handle,
          featuredImage: obj.featuredImage
        });
      } else if (obj.id?.includes('/ProductVariant/')) {
        // This is a variant
        variants.push({
          id: obj.id,
          parentId: obj.__parentId,
          title: obj.title,
          sku: obj.sku,
          price: obj.price,
          image: obj.image,
          mpn: obj.metafield?.value || null
        });
      }
    }

    console.log(`📦 Found ${products.size} products, ${variants.length} variants`);

    // Filter: only variants with MPN
    const filteredVariants = [];
    let skippedNoMpn = 0;

    for (const variant of variants) {
      const product = products.get(variant.parentId);
      
      if (!product) {
        continue; // Orphan variant, skip
      }

      if (!variant.mpn) {
        skippedNoMpn++;
        continue;
      }

      filteredVariants.push({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        image: variant.image,
        mpn: variant.mpn,
        product: {
          id: product.id,
          title: product.title,
          handle: product.handle,
          featuredImage: product.featuredImage
        }
      });
    }

    console.log(`✅ ${filteredVariants.length} variants to index`);
    console.log(`⏭️ Skipped: ${skippedNoMpn} variants without MPN`);

    return filteredVariants;
  }

  /**
   * Full bulk sync: start operation, poll, download, parse
   * Returns array of variants ready to index
   */
  async bulkFetchVariants(namespace, key, onProgress) {
    // Start the bulk operation
    const bulkOpId = await this.startBulkExport(namespace, key);

    // Poll until complete
    const downloadUrl = await this.pollBulkOperation(bulkOpId, onProgress);

    if (!downloadUrl) {
      console.log('⚠️ Bulk operation completed but no data URL (empty result set?)');
      return [];
    }

    // Download and parse
    const variants = await this.downloadAndParseBulkResults(downloadUrl);

    return variants;
  }

  /**
   * Fetch variants for a specific product (for webhook updates)
   */
  async fetchProductVariants(productGid, namespace, key) {
    const query = `
      query GetProductVariants($productId: ID!, $namespace: String!, $key: String!) {
        product(id: $productId) {
          id
          title
          handle
          featuredImage {
            url
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                image {
                  url
                }
                metafield(namespace: $namespace, key: $key) {
                  value
                }
              }
            }
          }
        }
      }
    `;

    const data = await this.query(query, {
      productId: productGid,
      namespace,
      key
    });

    if (!data.product) {
      return [];
    }

    return data.product.variants.edges.map(edge => ({
      ...edge.node,
      mpn: edge.node.metafield?.value || null,
      product: {
        id: data.product.id,
        title: data.product.title,
        handle: data.product.handle,
        featuredImage: data.product.featuredImage
      }
    }));
  }

  /**
   * Register webhooks for product updates
   */
  async registerWebhooks(hostUrl) {
    const webhooks = [
      { topic: 'PRODUCTS_UPDATE', path: '/api/sync/webhook/products-update' },
      { topic: 'PRODUCTS_DELETE', path: '/api/sync/webhook/products-delete' }
    ];

    const results = [];

    for (const webhook of webhooks) {
      const query = `
        mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
          webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
            webhookSubscription {
              id
              topic
              endpoint {
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
            }
            userErrors {
              field
              message
            }
          }
        }
      `;

      try {
        const data = await this.query(query, {
          topic: webhook.topic,
          webhookSubscription: {
            callbackUrl: `${hostUrl}${webhook.path}`,
            format: 'JSON'
          }
        });

        const result = data.webhookSubscriptionCreate;
        
        if (result.userErrors?.length > 0) {
          console.error(`❌ Webhook ${webhook.topic} errors:`, result.userErrors);
          results.push({ topic: webhook.topic, success: false, errors: result.userErrors });
        } else {
          console.log(`✅ Webhook registered: ${webhook.topic}`);
          results.push({ topic: webhook.topic, success: true, id: result.webhookSubscription?.id });
        }

      } catch (error) {
        console.error(`❌ Failed to register webhook ${webhook.topic}:`, error);
        results.push({ topic: webhook.topic, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * List existing webhooks
   */
  async listWebhooks() {
    const query = `
      query GetWebhooks {
        webhookSubscriptions(first: 25) {
          edges {
            node {
              id
              topic
              endpoint {
                ... on WebhookHttpEndpoint {
                  callbackUrl
                }
              }
              createdAt
            }
          }
        }
      }
    `;

    const data = await this.query(query);
    return data.webhookSubscriptions.edges.map(e => e.node);
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId) {
    const query = `
      mutation webhookSubscriptionDelete($id: ID!) {
        webhookSubscriptionDelete(id: $id) {
          deletedWebhookSubscriptionId
          userErrors {
            field
            message
          }
        }
      }
    `;

    const data = await this.query(query, { id: webhookId });
    return data.webhookSubscriptionDelete;
  }
}

module.exports = ShopifyGraphQLService;
