import { render } from 'preact';
import '@/app/globals.css';
import PublishTestPage from '@/app/publish/test/page';

render(<PublishTestPage />, document.getElementById('root')!);
