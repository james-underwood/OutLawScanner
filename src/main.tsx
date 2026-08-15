import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureStorage } from './db/storage';
import './styles.css';

// Storage is resolved before the app module loads, because importing it
// constructs the Dexie instance and Dexie captures the global at that point.
const storage = await ensureStorage();
const { App } = await import('./ui/App');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App storage={storage} />
  </StrictMode>,
);
