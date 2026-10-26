import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LANGUAGE, t } from './i18n';
import './index.css';

document.documentElement.lang = LANGUAGE;
document.title = t('PrintForge — Custom 3D Prints');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
