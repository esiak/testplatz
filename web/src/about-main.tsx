import './styles/tokens.css';
import './styles/base.css';
import { render } from 'preact';
import { AboutPage } from './about-page.tsx';

const root = document.getElementById('app');
if (root) render(<AboutPage />, root);
