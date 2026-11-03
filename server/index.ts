import 'dotenv/config';
import { createApp } from './app.js';

export const app = createApp();
const port = Number(process.env.PORT) || 3001;
app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`City Wander API listening on http://${process.env.HOST ?? '127.0.0.1'}:${port}`);
});
