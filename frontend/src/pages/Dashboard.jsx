import React, { useState, useEffect, useCallback } from 'react';
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Box,
  InlineGrid,
  Divider,
  Button,
  Spinner,
  Banner,
  TextField,
  DataTable,
  EmptyState,
  ProgressBar,
} from '@shopify/polaris';
import {
  SearchIcon,
  RefreshIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
} from '@shopify/polaris-icons';

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  
  // Data state
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncHistory, setSyncHistory] = useState([]);
  
  // Test search state
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const [statsRes, settingsRes, historyRes] = await Promise.all([
        fetch('/api/search/stats'),
        fetch('/api/settings'),
        fetch('/api/sync/history'),
      ]);

      const statsData = await statsRes.json();
      const settingsData = await settingsRes.json();
      const historyData = await historyRes.json();

      setStats(statsData);
      setSettings(settingsData);
      setSyncHistory(historyData);
      
      // Check for running sync
      const runningSync = historyData.find(s => s.status === 'running');
      if (runningSync) {
        setSyncStatus(runningSync);
        pollSyncStatus(runningSync.id);
      }

    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll sync status while running
  const pollSyncStatus = useCallback(async (jobId) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/sync/status/${jobId}`);
        const status = await res.json();
        setSyncStatus(status);
        
        if (status.status === 'running') {
          setTimeout(poll, 2000);
        } else {
          setSyncing(false);
          fetchData(); // Refresh all data
        }
      } catch (err) {
        console.error('Poll error:', err);
        setSyncing(false);
      }
    };
    
    poll();
  }, [fetchData]);

  // Start full sync
  const handleFullSync = async () => {
    setSyncing(true);
    setError(null);
    
    try {
      const res = await fetch('/api/sync/full', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        setSyncStatus({ status: 'running', id: data.jobId });
        pollSyncStatus(data.jobId);
      } else {
        setError(data.error || 'Failed to start sync');
        setSyncing(false);
      }
    } catch (err) {
      setError('Failed to start sync');
      setSyncing(false);
    }
  };

  // Test search
  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`);
      const results = await res.json();
      setSearchResults(results);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleString();
  };

  if (loading) {
    return (
      <Page title="MPN Search">
        <Layout>
          <Layout.Section>
            <Card>
              <Box padding="800" minHeight="400px">
                <InlineStack align="center" blockAlign="center">
                  <Spinner size="large" />
                </InlineStack>
              </Box>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const isConfigured = settings?.shop && stats;
  const hasIndex = stats?.total_variants > 0;

  return (
    <Page title="MPN Search">
      <BlockStack gap="500">
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        {/* Status Bar */}
        <Card>
          <Box padding="400">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="400" blockAlign="center">
                <Box>
                  {isConfigured ? (
                    <Badge tone="success">Connected</Badge>
                  ) : (
                    <Badge tone="attention">Not Configured</Badge>
                  )}
                </Box>
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">Index Status</Text>
                  <Text variant="bodySm" tone="subdued">
                    {settings?.shop || 'No shop configured'}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Button
                icon={RefreshIcon}
                onClick={handleFullSync}
                loading={syncing}
                disabled={!isConfigured}
              >
                {syncing ? 'Syncing...' : 'Full Sync'}
              </Button>
            </InlineStack>
          </Box>
        </Card>

        {/* Sync Progress (if running) */}
        {syncStatus?.status === 'running' && (
          <Card>
            <Box padding="400">
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text variant="headingSm">Sync in Progress</Text>
                  <Badge tone="info">Running</Badge>
                </InlineStack>
                <ProgressBar
                  progress={
                    syncStatus.total_variants > 0
                      ? (syncStatus.processed_variants / syncStatus.total_variants) * 100
                      : 0
                  }
                  size="small"
                />
                <Text variant="bodySm" tone="subdued">
                  {syncStatus.indexed_variants || 0} variants indexed
                </Text>
              </BlockStack>
            </Box>
          </Card>
        )}

        {/* Stats Grid */}
        <InlineGrid columns={{ xs: 1, md: 3 }} gap="500">
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Indexed Variants</Text>
                <Text variant="headingXl">{stats?.total_variants?.toLocaleString() || 0}</Text>
              </BlockStack>
            </Box>
          </Card>
          
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Products</Text>
                <Text variant="headingXl">{stats?.total_products?.toLocaleString() || 0}</Text>
              </BlockStack>
            </Box>
          </Card>
          
          <Card>
            <Box padding="400">
              <BlockStack gap="200">
                <Text variant="bodySm" tone="subdued">Last Updated</Text>
                <Text variant="headingSm">{formatDate(stats?.last_updated)}</Text>
              </BlockStack>
            </Box>
          </Card>
        </InlineGrid>

        {/* Test Search */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3">Test MPN Search</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <BlockStack gap="400">
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="300px">
                    <TextField
                      label="MPN"
                      value={searchTerm}
                      onChange={setSearchTerm}
                      placeholder="Enter MPN (e.g., 7665-PP)"
                      autoComplete="off"
                      onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                    />
                  </Box>
                  <Button
                    icon={SearchIcon}
                    onClick={handleSearch}
                    loading={searching}
                    disabled={!searchTerm.trim()}
                  >
                    Search
                  </Button>
                </InlineStack>

                {searchResults.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text']}
                    headings={['Product', 'Variant', 'MPN', 'SKU']}
                    rows={searchResults.map(r => [
                      r.productTitle,
                      r.variantTitle || '--',
                      r.mpn,
                      r.sku || '--'
                    ])}
                  />
                ) : searchTerm && !searching ? (
                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <Text tone="subdued" alignment="center">No results found for "{searchTerm}"</Text>
                  </Box>
                ) : null}
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Sync History */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3">Sync History</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              {syncHistory.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'numeric', 'text']}
                  headings={['Type', 'Status', 'Indexed', 'Completed']}
                  rows={syncHistory.slice(0, 10).map(s => [
                    s.sync_type,
                    <Badge tone={
                      s.status === 'completed' ? 'success' :
                      s.status === 'failed' ? 'critical' :
                      'info'
                    }>{s.status}</Badge>,
                    s.indexed_variants?.toLocaleString() || '--',
                    formatDate(s.completed_at)
                  ])}
                />
              ) : (
                <Box padding="400">
                  <Text tone="subdued" alignment="center">No sync history yet</Text>
                </Box>
              )}
            </Box>
          </BlockStack>
        </Card>

        {/* Configuration Info */}
        <Card>
          <BlockStack gap="400">
            <Box padding="400" paddingBlockEnd="0">
              <Text variant="headingMd" as="h3">Configuration</Text>
            </Box>
            <Divider />
            <Box padding="400" paddingBlockStart="0">
              <InlineGrid columns={2} gap="400">
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Metafield Namespace</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {settings?.metafieldNamespace || 'custom'}
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text variant="bodySm" tone="subdued">Metafield Key</Text>
                  <Text variant="bodyMd" fontWeight="semibold">
                    {settings?.metafieldKey || 'manufacturer_item_number'}
                  </Text>
                </BlockStack>
              </InlineGrid>
            </Box>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
