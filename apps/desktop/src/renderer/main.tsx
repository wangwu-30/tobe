import * as React from 'react';
import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import { DesktopApp } from './App';
import { installDesktopFetchBridge } from './install-desktop-fetch';

installDesktopFetchBridge();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Desktop renderer root element was not found.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <DesktopApp />
  </React.StrictMode>
);
