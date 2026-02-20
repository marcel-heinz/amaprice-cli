#!/usr/bin/env node

const { program } = require('commander');
const pkg = require('../package.json');
const KNOWN_COMMANDS = new Set(['price', 'track', 'history', 'list', 'help']);

const userArgs = process.argv.slice(2);
if (userArgs.length > 0) {
  const firstArg = userArgs[0];
  // Convenience mode: treat `amaprice <url-or-asin>` as `amaprice price <url-or-asin>`.
  if (!firstArg.startsWith('-') && !KNOWN_COMMANDS.has(firstArg)) {
    process.argv.splice(2, 0, 'price');
  }
}

program
  .name('amaprice')
  .description('CLI tool to scrape and track Amazon product prices')
  .version(pkg.version);

// Register commands
require('../src/commands/price')(program);
require('../src/commands/track')(program);
require('../src/commands/history')(program);
require('../src/commands/list')(program);

program.parse();
