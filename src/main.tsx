import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';
import { initAuth } from './lib/auth';
import { installErrorReporting } from './lib/report';

initAuth();
installErrorReporting();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
