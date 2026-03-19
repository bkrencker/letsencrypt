#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');

function extractJsonBlock(source, label) {
  // cf env prints named JSON blocks followed by the next section header.
  const pattern = new RegExp(
    `${label}:\\s*(\\{[\\s\\S]*?\\})\\s*(?:\\n\\n[A-Z][^:\\n]*:|$)`
  );
  const match = source.match(pattern);
  if (!match) {
    return null;
  }

  return JSON.parse(match[1]);
}

function main() {
  const appName = process.argv[2] || 'letsencrypt-srv';
  const outputFile = process.argv[3] || 'default-env.json';

  const cfOutput = execSync(`cf env ${appName}`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const vcapApplication = extractJsonBlock(cfOutput, 'VCAP_APPLICATION');
  if (!vcapApplication) {
    throw new Error('VCAP_APPLICATION not found in cf env output');
  }

  const payload = {
    VCAP_APPLICATION: vcapApplication
  };

  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${outputFile} for app ${appName}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
