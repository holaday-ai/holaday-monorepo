import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { bootstrapTheme } from './stores/theme-store';
import './index.css';

// Apply the persisted theme before the first paint so we don't flash
// white → dark on reload for dark-mode users.
bootstrapTheme();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found in index.html');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
