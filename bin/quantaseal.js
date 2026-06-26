#!/usr/bin/env node
/**
 * QuantaSeal CLI - Command-line interface for the QuantaSeal API.
 *
 * Usage:
 *   quantaseal health
 *   quantaseal status
 *   quantaseal config set api-key <key>
 *   quantaseal config set base-url <url>
 *   quantaseal encrypt --text "sensitive data"
 *   quantaseal decrypt --text "ciphertext..."
 *   quantaseal sign --text "data to sign"
 *   quantaseal verify --text "data" --signature "sig"
 *   quantaseal vault list
 *   quantaseal vault seal --name "api-key" --type api_key
 *   quantaseal vault unseal <entry-id>
 *   quantaseal vault delete <entry-id>
 *   quantaseal integrations list
 *   quantaseal integrations test <integration-id>
 *   quantaseal integrations delete <integration-id>
 *   quantaseal compliance report --framework soc2
 *   quantaseal audit logs --event-type CREDENTIAL_UNSEALED --hours 24
 *   quantaseal audit verify-chain --limit 100
 *
 * Configuration (environment variables):
 *   QUANTASEAL_API_URL     - API base URL (default: https://api.quantaseal.io)
 *   QUANTASEAL_API_KEY     - API key for authentication
 *
 * Legacy env vars also supported:
 *   QUANTASHIELD_API_URL / QUANTASHIELD_API_KEY
 */

const https = require('https');
const http = require('http');
const readline = require('readline');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { URL } = require('url');

const VERSION = '1.1.0';
const DEFAULT_API_URL = 'https://api.quantaseal.io';
const CONFIG_FILE = path.join(os.homedir(), '.quantaseal', 'config.json');

// ── Configuration ─────────────────────────────────────────────────────────

function loadConfigFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveConfigFile(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function getConfig() {
  const fileCfg = loadConfigFile();
  const apiUrl =
    process.env.QUANTASEAL_API_URL ||
    process.env.QUANTASHIELD_API_URL ||
    fileCfg.baseUrl ||
    DEFAULT_API_URL;
  const apiKey =
    process.env.QUANTASEAL_API_KEY ||
    process.env.QUANTASHIELD_API_KEY ||
    fileCfg.apiKey ||
    '';
  return { apiUrl, apiKey };
}

// ── HTTP Client ───────────────────────────────────────────────────────────

function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const config = getConfig();
    const url = new URL(path, config.apiUrl);
    const mod = url.protocol === 'https:' ? https : http;

    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `quantaseal-cli/${VERSION}`,
      },
    };

    if (config.apiKey) {
      options.headers['X-API-Key'] = config.apiKey;
    }
    if (bodyStr) {
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = mod.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function requireApiKey() {
  const { apiKey } = getConfig();
  if (!apiKey) {
    console.error('❌ API key not configured.');
    console.error('   Set it with:  quantaseal config set api-key qs_live_...');
    console.error('   Or export:    QUANTASEAL_API_KEY=qs_live_...');
    process.exit(1);
  }
}

function checkSuccess(res, label) {
  if (!res.data || res.status >= 400) {
    const msg = res.data?.error?.message || res.data?.detail || `HTTP ${res.status}`;
    console.error(`❌ ${label} failed: ${msg}`);
    process.exit(1);
  }
}

// ── Commands: config ──────────────────────────────────────────────────────

async function cmdConfig(args) {
  const sub = args[0];
  if (sub === 'set') {
    const key = args[1];
    const value = args[2];
    if (!key || !value) {
      console.error('Usage: quantaseal config set <api-key|base-url> <value>');
      process.exit(1);
    }
    const cfg = loadConfigFile();
    if (key === 'api-key') {
      cfg.apiKey = value;
      saveConfigFile(cfg);
      console.log(`✅ API key saved to ${CONFIG_FILE}`);
    } else if (key === 'base-url') {
      cfg.baseUrl = value;
      saveConfigFile(cfg);
      console.log(`✅ Base URL saved: ${value}`);
    } else {
      console.error(`Unknown config key: ${key}. Use api-key or base-url.`);
      process.exit(1);
    }
  } else if (sub === 'get' || !sub) {
    const cfg = loadConfigFile();
    const { apiUrl, apiKey } = getConfig();
    console.log(`Base URL: ${apiUrl}`);
    console.log(`API Key:  ${apiKey ? apiKey.slice(0, 12) + '...' : '(not set)'}`);
    console.log(`Config file: ${CONFIG_FILE}`);
  } else if (sub === 'clear') {
    saveConfigFile({});
    console.log('✅ Config cleared.');
  } else {
    console.error('Usage: quantaseal config <set|get|clear>');
    process.exit(1);
  }
}

// ── Commands: health / status ─────────────────────────────────────────────

async function cmdHealth() {
  const res = await apiRequest('GET', '/health');
  if (res.data.status === 'healthy') {
    console.log('✅ QuantaSeal API is healthy');
    console.log(`   Version:     ${res.data.version || '-'}`);
    console.log(`   Region:      ${res.data.region || '-'}`);
    console.log(`   Environment: ${res.data.environment || '-'}`);
    console.log(`   Database:    ${res.data.checks?.database || 'unknown'}`);
    console.log(`   Redis:       ${res.data.checks?.redis || 'unknown'}`);
    console.log(`   KMS:         ${res.data.checks?.kms || 'unknown'}`);
  } else {
    console.error('❌ QuantaSeal API is unhealthy');
    console.error(JSON.stringify(res.data, null, 2));
    process.exit(1);
  }
}

async function cmdStatus() {
  const { apiUrl, apiKey } = getConfig();
  console.log(`QuantaSeal CLI v${VERSION}`);
  console.log(`API URL: ${apiUrl}`);
  console.log(`API Key: ${apiKey ? apiKey.slice(0, 12) + '...' : '(not set)'}`);
  console.log(`Config:  ${CONFIG_FILE}`);
}

// ── Commands: encrypt / decrypt / sign / verify ───────────────────────────

async function cmdEncrypt(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  const file = getArg(args, '--file');
  if (!text && !file) {
    console.error('Usage: quantaseal encrypt --text "plaintext"');
    console.error('       quantaseal encrypt --file secret.txt --out secret.enc');
    process.exit(1);
  }

  const plaintext = text || fs.readFileSync(file, 'utf8').trim();
  const outFile = getArg(args, '--out');
  const algorithm = getArg(args, '--algorithm') || 'ML-KEM-768';

  const res = await apiRequest('POST', '/api/v2/encryption/encrypt', { plaintext, algorithm });
  checkSuccess(res, 'Encrypt');

  const ciphertext = res.data.data.ciphertext;
  if (outFile) {
    fs.writeFileSync(outFile, ciphertext);
    console.log(`✅ Encrypted → ${outFile}  (algorithm: ${res.data.data.encryption_metadata?.algorithm})`);
  } else {
    console.log(ciphertext);
  }
}

async function cmdDecrypt(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  const file = getArg(args, '--file');
  if (!text && !file) {
    console.error('Usage: quantaseal decrypt --text "ciphertext"');
    console.error('       quantaseal decrypt --file secret.enc');
    process.exit(1);
  }

  const ciphertext = text || fs.readFileSync(file, 'utf8').trim();
  const res = await apiRequest('POST', '/api/v2/encryption/decrypt', { ciphertext });
  checkSuccess(res, 'Decrypt');
  console.log(res.data.data.plaintext);
}

async function cmdSign(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  if (!text) {
    console.error('Usage: quantaseal sign --text "data to sign"');
    process.exit(1);
  }
  const res = await apiRequest('POST', '/api/v2/encryption/sign', {
    data: Buffer.from(text).toString('base64'),
  });
  checkSuccess(res, 'Sign');
  const { signature, algorithm } = res.data.data;
  console.log(`Signature: ${signature}`);
  console.log(`Algorithm: ${algorithm}`);
}

async function cmdVerify(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  const signature = getArg(args, '--signature') || getArg(args, '-s');
  if (!text || !signature) {
    console.error('Usage: quantaseal verify --text "data" --signature "sig..."');
    process.exit(1);
  }
  const res = await apiRequest('POST', '/api/v2/encryption/verify', {
    data: Buffer.from(text).toString('base64'),
    signature,
  });
  checkSuccess(res, 'Verify');
  if (res.data.data.valid) {
    console.log('✅ Signature is valid');
  } else {
    console.error('❌ Signature is INVALID');
    process.exit(1);
  }
}

// ── Commands: vault ───────────────────────────────────────────────────────

async function cmdVault(args) {
  requireApiKey();
  const subcommand = args[0];

  if (subcommand === 'list' || !subcommand) {
    const res = await apiRequest('GET', '/api/v2/vault/entries');
    checkSuccess(res, 'Vault list');
    const entries = res.data.data || [];
    if (entries.length === 0) {
      console.log('No vault entries.');
      return;
    }
    console.log(`${'ID'.padEnd(36)}  ${'NAME'.padEnd(30)}  ${'TYPE'.padEnd(18)}  ALGORITHM`);
    console.log('-'.repeat(100));
    for (const e of entries) {
      console.log(
        `${String(e.id || '').padEnd(36)}  ${String(e.name || '').padEnd(30)}  ${String(e.credential_type || '').padEnd(18)}  ${e.algorithm || ''}`
      );
    }
    console.log(`\n${entries.length} entry(ies)`);
  } else if (subcommand === 'seal') {
    const name = getArg(args, '--name');
    const type = getArg(args, '--type') || 'api_key';
    const secret = getArg(args, '--secret');
    const ttl = getArg(args, '--ttl-days') || '90';
    if (!name) {
      console.error('Usage: quantaseal vault seal --name "my-key" --type api_key [--secret "val"] [--ttl-days 90]');
      process.exit(1);
    }

    let plaintext;
    if (secret) {
      plaintext = { key: secret };
    } else {
      // Prompt securely for the secret
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      plaintext = await new Promise((resolve) => {
        rl.question('Secret value: ', (answer) => {
          rl.close();
          resolve({ key: answer });
        });
      });
    }

    const res = await apiRequest('POST', '/api/v2/vault/seal', {
      name,
      credential_type: type,
      plaintext,
      ttl_days: parseInt(ttl, 10),
    });
    checkSuccess(res, 'Vault seal');
    const entry = res.data.data;
    console.log(`✅ Sealed`);
    console.log(`   ID:        ${entry.id}`);
    console.log(`   Name:      ${entry.name}`);
    console.log(`   Algorithm: ${entry.algorithm}`);
    console.log(`   Expires:   ${entry.expires_at || 'never'}`);
  } else if (subcommand === 'unseal') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal vault unseal <entry-id>');
      process.exit(1);
    }
    const res = await apiRequest('GET', `/api/v2/vault/unseal/${id}`);
    checkSuccess(res, 'Vault unseal');
    const { plaintext, algorithm } = res.data.data;
    console.log(JSON.stringify(plaintext, null, 2));
    if (process.stderr.isTTY) {
      console.error(`(algorithm: ${algorithm})`);
    }
  } else if (subcommand === 'delete') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal vault delete <entry-id>');
      process.exit(1);
    }
    const res = await apiRequest('DELETE', `/api/v2/vault/entries/${id}`);
    checkSuccess(res, 'Vault delete');
    console.log(`✅ Vault entry ${id} deleted`);
  } else if (subcommand === 'rotate') {
    const id = args[1] || getArg(args, '--id');
    const secret = getArg(args, '--secret');
    if (!id) {
      console.error('Usage: quantaseal vault rotate <entry-id> --secret "new-value"');
      process.exit(1);
    }
    const new_plaintext = secret ? { key: secret } : undefined;
    const res = await apiRequest('POST', `/api/v2/vault/entries/${id}/rotate`, new_plaintext ? { new_plaintext } : {});
    checkSuccess(res, 'Vault rotate');
    console.log(`✅ Rotated vault entry ${id}`);
    console.log(`   Algorithm: ${res.data.data?.algorithm}`);
  } else {
    console.error('Usage: quantaseal vault <list|seal|unseal|delete|rotate>');
    process.exit(1);
  }
}

// ── Commands: integrations ────────────────────────────────────────────────

async function cmdIntegrations(args) {
  requireApiKey();
  const subcommand = args[0] || 'list';

  if (subcommand === 'list') {
    const res = await apiRequest('GET', '/api/v2/integrations');
    checkSuccess(res, 'Integrations list');
    const items = res.data.data || [];
    if (items.length === 0) {
      console.log('No integrations configured.');
      return;
    }
    console.log(`${'ID'.padEnd(36)}  ${'NAME'.padEnd(30)}  ${'TYPE'.padEnd(20)}  STATUS`);
    console.log('-'.repeat(100));
    for (const i of items) {
      const status = i.is_active ? '✅ active' : '⏸  inactive';
      console.log(`${String(i.id || '').padEnd(36)}  ${String(i.name || '').padEnd(30)}  ${String(i.system_type || '').padEnd(20)}  ${status}`);
    }
    console.log(`\n${items.length} integration(s)`);
  } else if (subcommand === 'test') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal integrations test <integration-id>');
      process.exit(1);
    }
    process.stdout.write(`Testing integration ${id}...`);
    const res = await apiRequest('POST', `/api/v2/integrations/${id}/test`);
    checkSuccess(res, 'Integration test');
    const { status, latency_ms } = res.data.data;
    if (status === 'success') {
      console.log(` ✅ Connected (${latency_ms}ms)`);
    } else {
      console.log(` ❌ Failed: ${res.data.data.error || status}`);
      process.exit(1);
    }
  } else if (subcommand === 'delete') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal integrations delete <integration-id>');
      process.exit(1);
    }
    const res = await apiRequest('DELETE', `/api/v2/integrations/${id}`);
    checkSuccess(res, 'Integration delete');
    console.log(`✅ Integration ${id} deleted`);
  } else if (subcommand === 'revoke') {
    const id = args[1] || getArg(args, '--id');
    const reason = getArg(args, '--reason') || 'Emergency revocation via CLI';
    if (!id) {
      console.error('Usage: quantaseal integrations revoke <integration-id> [--reason "..."]');
      process.exit(1);
    }
    const res = await apiRequest('POST', `/api/v2/security/emergency-revoke/${id}`, { reason });
    checkSuccess(res, 'Emergency revoke');
    console.log(`✅ Integration ${id} has been emergency-revoked`);
    console.log(`   All proxy requests for this integration are now blocked.`);
  } else {
    console.error('Usage: quantaseal integrations <list|test|delete|revoke>');
    process.exit(1);
  }
}

// ── Commands: compliance ──────────────────────────────────────────────────

const FRAMEWORKS = ['soc2', 'iso27001', 'pci_dss', 'hipaa', 'gdpr', 'nist_csf', 'fedramp', 'apra', 'nist_800_53'];

async function cmdCompliance(args) {
  requireApiKey();
  const subcommand = args[0] || 'report';

  if (subcommand === 'report') {
    const framework = getArg(args, '--framework') || getArg(args, '-f') || 'soc2';
    if (!FRAMEWORKS.includes(framework)) {
      console.error(`Unknown framework: ${framework}`);
      console.error(`Supported: ${FRAMEWORKS.join(', ')}`);
      process.exit(1);
    }

    process.stdout.write(`Generating ${framework.toUpperCase()} report...`);
    const res = await apiRequest('GET', `/api/v2/compliance/report?framework=${framework}`);
    checkSuccess(res, 'Compliance report');
    console.log(' done\n');

    const report = res.data.data;
    console.log(`Framework:    ${framework.toUpperCase()}`);
    console.log(`Score:        ${report.overall_score}/100`);
    console.log(`Generated:    ${report.generated_at || new Date().toISOString()}`);
    console.log('');
    console.log('Controls:');
    for (const ctrl of report.controls || []) {
      const icon = ctrl.status === 'compliant' ? '✅' : ctrl.status === 'non_compliant' ? '❌' : '-';
      console.log(`  ${icon}  ${ctrl.id.padEnd(20)} ${ctrl.status}`);
    }
    if (report.pdf_url) {
      console.log(`\nPDF: ${report.pdf_url}`);
    }
  } else if (subcommand === 'all') {
    console.log('Generating reports for all 9 frameworks...\n');
    for (const fw of FRAMEWORKS) {
      const res = await apiRequest('GET', `/api/v2/compliance/report?framework=${fw}`);
      if (res.data?.success) {
        const score = res.data.data.overall_score;
        const bar = '█'.repeat(Math.round(score / 5)).padEnd(20, '░');
        console.log(`  ${fw.padEnd(15)} ${bar} ${score}/100`);
      } else {
        console.log(`  ${fw.padEnd(15)} ❌ failed`);
      }
    }
  } else {
    console.error('Usage: quantaseal compliance report --framework soc2');
    console.error(`       quantaseal compliance all`);
    console.error(`Frameworks: ${FRAMEWORKS.join(', ')}`);
    process.exit(1);
  }
}

// ── Commands: audit ───────────────────────────────────────────────────────

async function cmdAudit(args) {
  requireApiKey();
  const subcommand = args[0] || 'logs';

  if (subcommand === 'logs') {
    const eventType = getArg(args, '--event-type') || getArg(args, '-e');
    const hours = getArg(args, '--hours') || getArg(args, '-H') || '24';
    const limit = getArg(args, '--limit') || '50';
    const outcome = getArg(args, '--outcome');

    let qs = `?limit=${limit}&hours=${hours}`;
    if (eventType) qs += `&event_type=${eventType}`;
    if (outcome) qs += `&outcome=${outcome}`;

    const res = await apiRequest('GET', `/api/v2/audit/logs${qs}`);
    checkSuccess(res, 'Audit logs');
    const logs = res.data.data || [];
    if (logs.length === 0) {
      console.log('No audit events found.');
      return;
    }
    for (const log of logs) {
      const ts = new Date(log.timestamp).toLocaleString();
      const outcome = log.outcome === 'success' ? '✅' : log.outcome === 'failure' ? '❌' : '-';
      console.log(`${outcome}  ${ts}  ${String(log.event_type || '').padEnd(35)}  ${log.actor_id || 'system'}`);
    }
    console.log(`\n${logs.length} event(s) (last ${hours}h)`);
  } else if (subcommand === 'verify-chain') {
    const limit = getArg(args, '--limit') || '100';
    process.stdout.write(`Verifying hash chain integrity (last ${limit} entries)...`);
    const res = await apiRequest('GET', `/api/v2/audit/logs?limit=${limit}&order=asc`);
    checkSuccess(res, 'Audit chain');
    const logs = res.data.data || [];
    let valid = true;
    let checked = 0;
    for (let i = 1; i < logs.length; i++) {
      if (logs[i].prev_hash !== logs[i - 1].current_hash) {
        valid = false;
        console.log('');
        console.error(`❌ Hash chain broken at entry ${i}: ${logs[i].id}`);
        console.error(`   Expected prev_hash: ${logs[i - 1].current_hash?.slice(0, 16)}...`);
        console.error(`   Got:               ${logs[i].prev_hash?.slice(0, 16)}...`);
      }
      checked++;
    }
    if (valid) {
      console.log(` ✅ valid (${checked} links checked)`);
    } else {
      process.exit(1);
    }
  } else {
    console.error('Usage: quantaseal audit logs [--event-type TYPE] [--hours 24] [--limit 50]');
    console.error('       quantaseal audit verify-chain [--limit 100]');
    process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) {
    return args[idx + 1];
  }
  return null;
}

function printUsage() {
  console.log(`
QuantaSeal CLI v${VERSION}
Quantum-safe encryption, vault, and compliance from the command line.

Usage:
  quantaseal <command> [options]

Configuration:
  config set api-key <key>          Save API key to ~/.quantaseal/config.json
  config set base-url <url>         Save API base URL
  config get                        Show current config

Core:
  health                            Check API health
  status                            Show CLI configuration
  encrypt --text <text>             Encrypt plaintext (ML-KEM-768)
  encrypt --file <in> --out <out>   Encrypt file
  decrypt --text <ciphertext>       Decrypt ciphertext
  decrypt --file <enc>              Decrypt file
  sign --text <data>                Sign data (ML-DSA-65)
  verify --text <data> --signature  Verify signature

Vault:
  vault list                        List all sealed credentials
  vault seal --name --type          Seal a new credential
  vault unseal <entry-id>           Retrieve a sealed credential
  vault rotate <entry-id>           Re-seal with new value
  vault delete <entry-id>           Delete a vault entry

Integrations:
  integrations list                 List all integrations
  integrations test <id>            Test integration connectivity
  integrations delete <id>          Delete integration
  integrations revoke <id>          Emergency revoke (block all proxy)

Compliance:
  compliance report --framework soc2   Generate compliance report
  compliance all                       Report for all 9 frameworks

Audit:
  audit logs [--event-type] [--hours]  Query immutable audit log
  audit verify-chain [--limit]         Verify SHA3-256 hash chain

Environment:
  QUANTASEAL_API_URL      API base URL (default: ${DEFAULT_API_URL})
  QUANTASEAL_API_KEY      API key for authentication

Frameworks: ${FRAMEWORKS.join(', ')}
`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  try {
    switch (command) {
      case 'health':
        await cmdHealth();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'config':
        await cmdConfig(args.slice(1));
        break;
      case 'encrypt':
        await cmdEncrypt(args.slice(1));
        break;
      case 'decrypt':
        await cmdDecrypt(args.slice(1));
        break;
      case 'sign':
        await cmdSign(args.slice(1));
        break;
      case 'verify':
        await cmdVerify(args.slice(1));
        break;
      case 'vault':
        await cmdVault(args.slice(1));
        break;
      case 'integrations':
        await cmdIntegrations(args.slice(1));
        break;
      case 'compliance':
        await cmdCompliance(args.slice(1));
        break;
      case 'audit':
        await cmdAudit(args.slice(1));
        break;
      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
