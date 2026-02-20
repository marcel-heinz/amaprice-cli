#!/usr/bin/env node

const { program } = require('commander');
const pkg = require('../package.json');

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
