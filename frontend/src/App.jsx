import React, { useState, useCallback } from 'react';
import { AppProvider, Frame, Navigation } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';

// Import pages
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';

// Icons
import { HomeIcon, SettingsIcon } from '@shopify/polaris-icons';

export default function App() {
  const [selectedNavItem, setSelectedNavItem] = useState('dashboard');
  const [mobileNavigationActive, setMobileNavigationActive] = useState(false);

  const toggleMobileNavigationActive = useCallback(
    () => setMobileNavigationActive((active) => !active),
    []
  );

  const navigationMarkup = (
    <Navigation location="/">
      <Navigation.Section
        items={[
          {
            label: 'Dashboard',
            icon: HomeIcon,
            onClick: () => setSelectedNavItem('dashboard'),
            selected: selectedNavItem === 'dashboard',
          },
          {
            label: 'Settings',
            icon: SettingsIcon,
            onClick: () => setSelectedNavItem('settings'),
            selected: selectedNavItem === 'settings',
          },
        ]}
      />
    </Navigation>
  );

  const renderPage = () => {
    switch (selectedNavItem) {
      case 'dashboard':
        return <Dashboard />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <AppProvider
      i18n={{
        Polaris: {
          Avatar: { label: 'Avatar', labelWithInitials: 'Avatar with initials {initials}' },
          Frame: { skipToContent: 'Skip to content' },
        },
      }}
    >
      <Frame
        navigation={navigationMarkup}
        showMobileNavigation={mobileNavigationActive}
        onNavigationDismiss={toggleMobileNavigationActive}
      >
        {renderPage()}
      </Frame>
    </AppProvider>
  );
}
