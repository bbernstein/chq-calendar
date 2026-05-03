import { render } from 'preact';
import '@/app/globals.css';
import PublishStatusPage from '@/app/publish/status/page';

render(<PublishStatusPage />, document.getElementById('root')!);
