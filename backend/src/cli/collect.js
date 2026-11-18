'use strict';
// Run one collector once from the terminal: node src/cli/collect.js ndbc
const db = require('../db');
const { runOnce } = require('../collectors');

const id = process.argv[2];
if (!id) {
  console.error('Usage: node src/cli/collect.js <source-id>   (example: ndbc)');
  process.exit(1);
}
(async () => {
  try {
    await db.waitForDb(3);
    await db.migrate();
    const summary = await runOnce(id);
    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    if (!/failed:/.test(err.message)) console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
