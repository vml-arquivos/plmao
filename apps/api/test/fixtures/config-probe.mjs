try {
  await import('../../dist/config.js');
  console.log('CONFIG_OK');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
