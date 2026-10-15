import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { chromeApi } from '../ui/api';
import { Popup } from '../ui/Popup';

createRoot(document.getElementById('root')!).render(<Popup api={chromeApi} />);
