import { render } from 'preact';
import '@/app/globals.css';
import LoginPage from '@/app/admin/login/page';

render(<LoginPage />, document.getElementById('root')!);
