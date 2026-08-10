import { render } from 'preact';
import '@/app/globals.css';
import Home from '@/app/page';
import { startVersionWatch } from '@/lib/versionCheck';

const root = document.getElementById('root')!;
root.replaceChildren(); // drop static SEO fallback before Preact mounts
render(<Home />, root);

// Auto-reload installed/home-screen users onto new deploys.
startVersionWatch();
