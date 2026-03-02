import { render } from 'preact';
import '@/app/globals.css';
import FeedbackManagementPage from '@/app/admin/feedback/page';

render(<FeedbackManagementPage />, document.getElementById('root')!);
