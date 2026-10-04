import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/app.css';
import { App } from './App';
import { registerServiceWorker } from './app/pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
registerServiceWorker();
