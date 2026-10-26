import './styles/tokens.css';
import './styles/base.css';
import { render } from 'preact';
import { App } from './app.tsx';

const root = document.getElementById('app');
if (root) render(<App />, root);
