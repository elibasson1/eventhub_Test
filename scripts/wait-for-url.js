// Waits until every URL given on the command line answers with HTTP < 500.
// Usage: node scripts/wait-for-url.js <url> [url...]   (timeout: WAIT_TIMEOUT_MS, default 120s)
const urls = process.argv.slice(2);
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS ?? 120_000);
const deadline = Date.now() + timeoutMs;

async function isUp(url) {
  try {
    const res = await fetch(url);
    return res.status < 500;
  } catch {
    return false;
  }
}

(async () => {
  for (const url of urls) {
    process.stdout.write(`Waiting for ${url} `);
    while (!(await isUp(url))) {
      if (Date.now() > deadline) {
        console.error(`\nTimed out after ${timeoutMs}ms waiting for ${url}`);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
      process.stdout.write('.');
    }
    console.log(' up');
  }
})();
