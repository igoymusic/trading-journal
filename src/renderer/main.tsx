import { ErrorBoundary } from './ErrorBoundary';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label="this page" closeText="Reload" onClose={() => location.reload()}>
    <App />
  </ErrorBoundary>,
);
