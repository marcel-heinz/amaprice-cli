const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(require('os').homedir(), '.amaprice');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

/**
 * Load Supabase credentials with 3-tier priority:
 * 1. Environment variables
 * 2. ~/.amaprice/config.json
 * 3. .env file in CWD
 */
function loadConfig() {
  // 1. Env vars (highest priority)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
    return {
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_KEY,
    };
  }

  // 2. Config file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (data.supabaseUrl && data.supabaseKey) {
        return data;
      }
    } catch {
      // Fall through
    }
  }

  // 3. .env file in CWD
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const env = parseEnvFile(envPath);
    if (env.SUPABASE_URL && env.SUPABASE_KEY) {
      return {
        supabaseUrl: env.SUPABASE_URL,
        supabaseKey: env.SUPABASE_KEY,
      };
    }
  }

  return null;
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function requireConfig() {
  const config = loadConfig();
  if (!config) {
    console.error('Error: Supabase credentials not configured.');
    console.error('Run `amaprice init` to set up, or set SUPABASE_URL and SUPABASE_KEY env vars.');
    process.exit(1);
  }
  return config;
}

module.exports = { loadConfig, saveConfig, requireConfig, CONFIG_DIR, CONFIG_FILE };
