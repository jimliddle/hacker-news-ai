#!/usr/bin/env node
// Recomputes the SHA-256 hash of the inline <script> in index.html and writes it
// into the Content-Security-Policy meta tag. Run this after editing the script.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) {
  console.error(`Expected exactly one inline <script> in index.html, found ${scripts.length}.`);
  process.exit(1);
}
const hash = 'sha256-' + crypto.createHash('sha256').update(scripts[0][1], 'utf8').digest('base64');
const updated = html.replace(/script-src '[^']*'/, `script-src '${hash}'`);
if (updated === html) {
  console.log(`Hash already up to date: ${hash}`);
} else {
  fs.writeFileSync(file, updated);
  console.log(`Updated script-src to ${hash}`);
}
