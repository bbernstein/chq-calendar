import { render } from 'preact';
import '@/app/globals.css';
import AdminIndexPage from '@/app/admin/page';

render(<AdminIndexPage />, document.getElementById('root')!);
