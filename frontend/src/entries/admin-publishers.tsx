import { render } from 'preact';
import '@/app/globals.css';
import PublishersPage from '@/app/admin/publishers/page';

render(<PublishersPage />, document.getElementById('root')!);
