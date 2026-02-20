const readline = require('node:readline');

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

function ask(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

async function resolveCliInput(inputParts, promptText = 'Amazon URL or ASIN: ') {
  const joined = Array.isArray(inputParts) ? inputParts.join(' ').trim() : String(inputParts || '').trim();
  if (joined) return joined;

  if (!process.stdin.isTTY) {
    return readStdin();
  }

  return ask(promptText);
}

module.exports = { resolveCliInput };
