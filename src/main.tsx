import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { RecordingProvider } from './context/RecordingContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecordingProvider>
      <App />
    </RecordingProvider>
  </StrictMode>
);
