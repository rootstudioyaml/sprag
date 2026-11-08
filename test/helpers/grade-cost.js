// Side-effect import: this process reads grade 'cost' from a temp data directory.
// Keep it the first import of the test file (see grade-config.js).
import { useGrade } from './grade-config.js';

useGrade('cost');
