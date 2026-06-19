import './style.css';
import { initApp } from './app';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  initApp(app);
}
