import { createRoot } from 'react-dom/client';
import '../ui/styles.css';
import { chromeApi } from '../ui/api';
import { ReportView } from '../ui/ReportView';

createRoot(document.getElementById('root')!).render(<ReportView api={chromeApi} />);
