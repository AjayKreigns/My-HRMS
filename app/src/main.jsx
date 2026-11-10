import { createRoot } from 'react-dom/client';
import '@fontsource/plus-jakarta-sans/400.css';
import '@fontsource/plus-jakarta-sans/500.css';
import '@fontsource/plus-jakarta-sans/600.css';
import '@fontsource/plus-jakarta-sans/700.css';
import '@fontsource/plus-jakarta-sans/800.css';
import './styles.css';
import App from './App.jsx';
// Loaded after every page's own styles so the glass layer sits on top.
import './glass.css';

createRoot(document.getElementById('root')).render(<App />);
