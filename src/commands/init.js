const readline = require('readline');
const { saveConfig, CONFIG_FILE } = require('../config');

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

module.exports = function (program) {
  program
    .command('init')
    .description('Interactive Supabase credential setup')
    .action(async () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      console.log('Configure Supabase credentials for amaprice.\n');

      try {
        const supabaseUrl = await prompt(rl, 'Supabase URL: ');
        const supabaseKey = await prompt(rl, 'Supabase anon key: ');

        if (!supabaseUrl || !supabaseKey) {
          console.error('Error: Both URL and key are required.');
          process.exit(1);
        }

        saveConfig({ supabaseUrl, supabaseKey });
        console.log(`\nCredentials saved to ${CONFIG_FILE}`);
        console.log('\nSupabase SQL schema (run this in your Supabase SQL editor):\n');
        console.log(`CREATE TABLE products (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  asin        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  domain      TEXT NOT NULL DEFAULT 'amazon.de',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE price_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       DECIMAL(10, 2) NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'EUR',
  scraped_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_products_asin ON products (asin);
CREATE INDEX idx_price_history_product_time ON price_history (product_id, scraped_at DESC);`);
      } finally {
        rl.close();
      }
    });
};
