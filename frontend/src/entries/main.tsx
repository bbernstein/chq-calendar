import { render } from 'preact';
import '@/app/globals.css';
import Home from '@/app/page';
import { startVersionWatch } from '@/lib/versionCheck';

render(<Home />, document.getElementById('root')!);

// Auto-reload installed/home-screen users onto new deploys.
startVersionWatch();
