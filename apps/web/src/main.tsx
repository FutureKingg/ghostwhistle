import { Buffer } from 'buffer';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Some Midnight SDK packages still expect Node's Buffer global while running
// in the browser. Register the browser implementation before the SDK is
// loaded dynamically by the Lace connection flow.
globalThis.Buffer ??= Buffer;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
