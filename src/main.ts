import { mount } from 'svelte';
import App from './App.svelte';
import { watchErrors } from './net/reports';
import './theme/tokens.css';

// anonymous reports of anything that breaks (the real site only; see net/reports.ts)
watchErrors();

mount(App, { target: document.getElementById('app')! });
