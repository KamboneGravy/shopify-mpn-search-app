import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Divider,
  Button,
  Banner,
  TextField,
  Badge,
  DataTable,
  Modal,
  TextContainer,
} from '@shopify/polaris';
import { ClipboardIcon, DeleteIcon, RefreshIcon } from '@shopify/polaris-icons';

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [webhooks, setWebhooks] = useState([]);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Modal state
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Copy endpoint URL to clipboard
  const copyEndpoint = () => {
    const url = `${window.location.origin}/api/search?q=YOUR_MPN`;
    navigator.clipboard.writeText(url);
    setSuccess('Endpoint URL copied to clipboard');
    setTimeout(() => setSuccess(null), 3000);
  };

  // Generate frontend code snippet
  const generateSnippet = () => {
    const baseUrl = window.location.origin;
    return `async checkMpnMatch(searchTerm) {
  try {
    const normalized = searchTerm.replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (normalized.length < 2) return [];
    
    const response = await fetch(
      \`${baseUrl}/api/search?q=\${encodeURIComponent(normalized)}\`
    );
    
    if (!response.ok) return [];
    
    const matches = await response.json();
    console.log('[MPN] Sidecar returned:', matches);
    return matches;
    
  } catch (error) {
    console.error('[MPN] Sidecar error:', error);
    return [];
  }
}`;
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(generateSnippet());
    setSuccess('Code snippet copied to clipboard');
    setTimeout(() => setSuccess(null), 3000);
  };

  // Clear index (with confirmation)
  const handleClearIndex = async () => {
    setClearing(true);
    try {
      // We'll need to add this endpoint
      const res = await fetch('/api/sync/clear', { method: 'POST' });
      if (res.ok) {
        setSuccess('Index cleared successfully');
        setClearModalOpen(false);
      } else {
        setError('Failed to clear index');
      }
    } catch (err) {
      setError('Failed to clear index');
    } finally {
      setClearing(false);
    }
  };

  if (loading) {
    return (
      <Page title="Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="800">
                <Text>Loading...</Text>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page title="Settings">
      <BlockStack gap="500">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}
        
        {success && (
          <Banner tone="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Banner>
        )}

        {/* API Endpoint */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h3">Search API Endpoint</Text>
                <Badge tone="success">Active</Badge>
              </InlineStack>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <BlockStack gap="400">
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text variant="bodyMd" fontWeight="semibold" as="span">
                      <code>GET /api/search?q=MPN_VALUE</code>
                    </Text>
                    <Button icon={ClipboardIcon} onClick={copyEndpoint} size="slim">
                      Copy URL
                    </Button>
                  </InlineStack>
                </Box>
                
                <BlockStack gap="200">
                  <Text variant="bodySm" fontWeight="semibold">Response Format:</Text>
                  <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                    <pre style={{ margin: 0, fontSize: '12px', overflow: 'auto' }}>
{`[
  {
    "productHandle": "product-slug",
    "variantId": "gid://shopify/ProductVariant/123",
    "productTitle": "Product Name",
    "variantTitle": "Variant Name",
    "mpn": "7665-PP",
    "sku": "SKU-123",
    "image": "https://cdn.shopify.com/...",
    "price": "12.99"
  }
]`}
                    </pre>
                  </Box>
                </BlockStack>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Theme Integration Code */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <InlineStack align="space-between" blockAlign="center">
                <Text variant="headingMd" as="h3">Theme Integration</Text>
                <Button icon={ClipboardIcon} onClick={copySnippet} size="slim">
                  Copy Code
                </Button>
              </InlineStack>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <BlockStack gap="300">
                <Text variant="bodySm" tone="subdued">
                  Replace the <code>checkMpnMatch()</code> method in your theme's search file:
                </Text>
                <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                  <pre style={{ margin: 0, fontSize: '11px', overflow: 'auto', maxHeight: '300px' }}>
                    {generateSnippet()}
                  </pre>
                </Box>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Metafield Configuration */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3">Metafield Configuration</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <BlockStack gap="400">
                <Text variant="bodySm" tone="subdued">
                  The app indexes variant metafields with this namespace and key.
                  Change these in your <code>.env</code> file.
                </Text>
                
                <InlineStack gap="400">
                  <Box minWidth="200px">
                    <TextField
                      label="Namespace"
                      value={settings?.metafieldNamespace || 'custom'}
                      disabled
                      helpText="MPN_METAFIELD_NAMESPACE"
                    />
                  </Box>
                  <Box minWidth="300px">
                    <TextField
                      label="Key"
                      value={settings?.metafieldKey || 'manufacturer_item_number'}
                      disabled
                      helpText="MPN_METAFIELD_KEY"
                    />
                  </Box>
                </InlineStack>
                
                <Banner tone="info">
                  <p>
                    Your variants should have the MPN stored in: <br />
                    <strong>custom.manufacturer_item_number</strong>
                  </p>
                </Banner>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Shop Configuration */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3">Shopify Connection</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text variant="bodySm" tone="subdued">Shop:</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {settings?.shop || 'Not configured'}
                  </Text>
                  {settings?.shop && <Badge tone="success">Connected</Badge>}
                </InlineStack>
                
                {!settings?.shop && (
                  <Banner tone="warning">
                    <p>
                      Set <code>SHOPIFY_SHOP</code> and <code>SHOPIFY_ACCESS_TOKEN</code> in your .env file to enable syncing.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Danger Zone */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3" tone="critical">Danger Zone</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="bodyMd" fontWeight="semibold">Clear Search Index</Text>
                  <Text variant="bodySm" tone="subdued">
                    Remove all indexed variants. You'll need to run a full sync after.
                  </Text>
                </BlockStack>
                <Button
                  icon={DeleteIcon}
                  tone="critical"
                  onClick={() => setClearModalOpen(true)}
                >
                  Clear Index
                </Button>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Clear Index Confirmation Modal */}
      <Modal
        open={clearModalOpen}
        onClose={() => setClearModalOpen(false)}
        title="Clear Search Index?"
        primaryAction={{
          content: 'Clear Index',
          destructive: true,
          loading: clearing,
          onAction: handleClearIndex,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setClearModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <TextContainer>
            <p>
              This will remove all indexed variants from the MPN search database.
              MPN search will return no results until you run a full sync.
            </p>
            <p>
              <strong>This action cannot be undone.</strong>
            </p>
          </TextContainer>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
