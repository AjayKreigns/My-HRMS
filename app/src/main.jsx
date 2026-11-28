import { startTransition } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './styles.css';
import App from './App.jsx';
// Loaded after every page's own styles so the glass layer sits on top.
import './glass.css';

// Drawn as a transition so React works in slices of a few milliseconds and lets the browser breathe between them,
// instead of one block of work that freezes a slow phone while the first screen is built.
const root = createRoot(document.getElementById('root'));
startTransition(() => root.render(<App />));
