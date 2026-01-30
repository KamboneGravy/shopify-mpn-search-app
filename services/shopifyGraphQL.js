// services/shopifyGraphQL.js - Shopify GraphQL Client for Variant + Metafield Queries
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
   * Fetch products published to Online Store with their variants and MPN metafield
   * Uses onlineStoreUrl to determine if product is on Online Store (no extra scope needed)
   */
  async fetchVariantsWithMetafield(namespace, key, cursor = null, limit = 50) {
    const query = `
      query GetProducts($cursor: String, $limit: Int!, $namespace: String!, $key: String!) {
        products(first: $limit, after: $cursor, query: "published_status:published") {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              handle
              onlineStoreUrl
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
        }
      }
    `;

    const data = await this.query(query, {
      cursor,
      limit,
      namespace,
      key
    });

    // Filter to only products with onlineStoreUrl (published to Online Store)
    const variants = [];
    let skippedProducts = 0;
    
    for (const productEdge of data.products.edges) {
      const product = productEdge.node;
      
      // Skip products not on Online Store (no onlineStoreUrl means not published there)
      if (!product.onlineStoreUrl) {
        skippedProducts++;
        continue;
      }

      for (const variantEdge of product.variants.edges) {
        const variant = variantEdge.node;
        const mpn = variant.metafield?.value || null;
        
        // Only include variants with MPN
        if (mpn) {
          variants.push({
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            price: variant.price,
            image: variant.image,
            mpn,
            product: {
              id: product.id,
              title: product.title,
              handle: product.handle,
              featuredImage: product.featuredImage
            }
          });
        }
      }
    }

    if (skippedProducts > 0) {
      console.log(`⏭️ Skipped ${skippedProducts} products not on Online Store`);
    }

    return {
      variants,
      pageInfo: data.products.pageInfo
    };
  }

  /**
   * Fetch variants for a specific product (for webhook updates)
   * Also checks if product is published to Online Store
   */
  async fetchProductVariants(productGid, namespace, key) {
    const query = `
      query GetProductVariants($productId: ID!, $namespace: String!, $key: String!) {
        product(id: $productId) {
          id
          title
          handle
          onlineStoreUrl
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

    // If product has no onlineStoreUrl, it's not on Online Store
    if (!data.product.onlineStoreUrl) {
      console.log(`⏭️ Product ${productGid} not published to Online Store, skipping`);
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
   * Get total variant count (for progress tracking)
   */
  async getVariantCount() {
    const query = `
      query GetVariantCount {
        productVariants(first: 1) {
          totalCount
        }
      }
    `;

    try {
      const data = await this.query(query);
      return data.productVariants.totalCount || null;
    } catch {
      return null;
    }
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
