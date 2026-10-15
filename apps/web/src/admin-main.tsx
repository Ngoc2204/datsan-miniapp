import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import './styles.css';

createRoot(document.getElementById('admin-app')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
