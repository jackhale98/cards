// Every game's rules, loaded before any test runs (a Host looks them up as they're needed).
import { loadAllRules } from '../src/games';

await loadAllRules();
