#!/usr/bin/env node
/**
 * QuantaSeal CLI - Command-line interface for the QuantaSeal API.
 *
 * Usage:
 *   quantaseal health
 *   quantaseal status
 *   quantaseal config set api-key <key>
 *   quantaseal config set base-url <url>
 *   quantaseal encrypt --text "sensitive data" --out secret.enc.json
 *   quantaseal decrypt --file secret.enc.json
 *   quantaseal sign --text "data to sign" --out sig.json
 *   quantaseal verify --signature-file sig.json
 *   quantaseal vault list
 *   quantaseal vault seal --name "api-key" --type api_key
 *   quantaseal vault unseal <entry-id>
 *   quantaseal vault delete <entry-id>
 *   quantaseal integrations list
 *   quantaseal integrations test <integration-id>
 *   quantaseal integrations delete <integration-id>
 *   quantaseal compliance report --framework soc2
 *   quantaseal audit logs --limit 10
 *   quantaseal audit verify-chain --from 2026-01-01 --to 2026-02-01
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
    console.error('   Set it with:  quantaseal config set api-key qsk_live_...');
    console.error('   Or export:    QUANTASEAL_API_KEY=qsk_live_...');
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

  // The API requires base64-encoded plaintext.
  const plaintextB64 = Buffer.from(plaintext, 'utf8').toString('base64');
  const res = await apiRequest('POST', '/api/v2/encryption/encrypt', {
    plaintext: plaintextB64,
    algorithm,
  });
  checkSuccess(res, 'Encrypt');

  // Decrypt needs the FULL envelope, not just the ciphertext string - save/print
  // it as JSON so `quantaseal decrypt` can round-trip it later.
  const { envelope, encryption_metadata } = res.data.data;
  const envelopeJson = JSON.stringify(envelope, null, 2);
  if (outFile) {
    fs.writeFileSync(outFile, envelopeJson);
    console.log(`✅ Encrypted → ${outFile}  (algorithm: ${encryption_metadata?.algorithm})`);
    console.log(`   Decrypt with: quantaseal decrypt --file ${outFile}`);
  } else {
    console.log(envelopeJson);
  }
}

async function cmdDecrypt(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  const file = getArg(args, '--file');
  if (!text && !file) {
    console.error('Usage: quantaseal decrypt --file secret.enc.json');
    console.error('       quantaseal decrypt --text \'{"encrypted": {...}, "signature": {...}}\'');
    console.error('(the argument must be the full JSON envelope printed by `quantaseal encrypt`, not a bare ciphertext string)');
    process.exit(1);
  }

  const raw = text || fs.readFileSync(file, 'utf8');
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    console.error('❌ Could not parse input as a JSON envelope. Decrypt requires the full envelope object from `quantaseal encrypt`, not a ciphertext string.');
    process.exit(1);
  }

  const res = await apiRequest('POST', '/api/v2/encryption/decrypt', {
    envelope,
    verify_signature: true,
  });
  checkSuccess(res, 'Decrypt');
  const { plaintext, signature_valid } = res.data.data;
  console.log(Buffer.from(plaintext, 'base64').toString('utf8'));
  if (process.stderr.isTTY) {
    console.error(`(signature_valid: ${signature_valid})`);
  }
}

async function cmdSign(args) {
  requireApiKey();
  const text = getArg(args, '--text') || getArg(args, '-t');
  const outFile = getArg(args, '--out');
  if (!text) {
    console.error('Usage: quantaseal sign --text "data to sign" [--out sig.json]');
    process.exit(1);
  }
  const res = await apiRequest('POST', '/api/v2/encryption/sign', {
    data: Buffer.from(text, 'utf8').toString('base64'),
  });
  checkSuccess(res, 'Sign');
  const { signature, hmac_signature, public_key, algorithm } = res.data.data;
  // `verify` needs all four of these - bundle them so they can be passed
  // straight to `quantaseal verify --signature-file`.
  const bundle = { data: text, signature, hmac_signature, public_key, algorithm };
  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(bundle, null, 2));
    console.log(`✅ Signed → ${outFile}  (algorithm: ${algorithm})`);
    console.log(`   Verify with: quantaseal verify --signature-file ${outFile}`);
  } else {
    console.log(JSON.stringify(bundle, null, 2));
  }
}

async function cmdVerify(args) {
  requireApiKey();
  const sigFile = getArg(args, '--signature-file');
  let text, signature, hmac_signature, public_key;
  if (sigFile) {
    const bundle = JSON.parse(fs.readFileSync(sigFile, 'utf8'));
    ({ data: text, signature, hmac_signature, public_key } = bundle);
  } else {
    text = getArg(args, '--text') || getArg(args, '-t');
    signature = getArg(args, '--signature') || getArg(args, '-s');
    hmac_signature = getArg(args, '--hmac-signature');
    public_key = getArg(args, '--public-key');
  }
  if (!text || !signature || !hmac_signature || !public_key) {
    console.error('Usage: quantaseal verify --signature-file sig.json');
    console.error('       quantaseal verify --text "data" --signature "..." --hmac-signature "..." --public-key "..."');
    console.error('(verification requires all four values that `quantaseal sign` returned - it is not enough to pass just the signature)');
    process.exit(1);
  }
  const res = await apiRequest('POST', '/api/v2/encryption/verify', {
    data: Buffer.from(text, 'utf8').toString('base64'),
    signature,
    hmac_signature,
    public_key,
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
    // Platform max is 24h (1 day) by default - short-lived credentials by
    // design, so a stolen secret expires quickly. Use `vault rotate` to
    // refresh an entry before it expires rather than requesting a longer TTL.
    const ttl = getArg(args, '--ttl-days') || '1';
    if (!name) {
      console.error('Usage: quantaseal vault seal --name "my-key" --type api_key [--secret "val"] [--ttl-days 1]');
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
    console.log(`   Entry ID:  ${entry.entry_id}`);
    console.log(`   Name:      ${name}`);
    console.log(`   TTL:       ${ttl} days`);
    if (entry.mpc_enabled) {
      console.log('');
      console.log('⚠️  MPC split custody is enabled for this entry.');
      console.log(`   Custody key (one-time, save now - QuantaSeal cannot recover it if lost):`);
      console.log(`   ${entry.custody_key_hex}`);
    }
  } else if (subcommand === 'unseal') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal vault unseal <entry-id>');
      process.exit(1);
    }
    const res = await apiRequest('POST', `/api/v2/vault/unseal/${id}`);
    checkSuccess(res, 'Vault unseal');
    const { plaintext, last_accessed_at } = res.data.data;
    console.log(JSON.stringify(plaintext, null, 2));
    if (process.stderr.isTTY && last_accessed_at) {
      console.error(`(previously accessed: ${last_accessed_at})`);
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
    if (!id) {
      console.error('Usage: quantaseal vault rotate <entry-id>');
      process.exit(1);
    }
    // Rotate re-encrypts the existing plaintext under a fresh key - it does
    // not accept a new value. To change the secret itself, seal a new entry.
    const res = await apiRequest('POST', `/api/v2/vault/rotate/${id}`);
    checkSuccess(res, 'Vault rotate');
    console.log(`✅ Rotated vault entry ${id}`);
    console.log(`   New entry ID: ${res.data.data?.new_entry_id}`);
    console.log(`   Old entry ID is now retired: ${res.data.data?.old_entry_id}`);
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
    const res = await apiRequest('GET', '/api/v2/proxy/integrations');
    checkSuccess(res, 'Integrations list');
    const items = res.data.data?.integrations || [];
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
    const res = await apiRequest('POST', `/api/v2/proxy/integrations/${id}/test`);
    checkSuccess(res, 'Integration test');
    const { success, latency_ms, message } = res.data.data;
    if (success) {
      console.log(` ✅ Connected (${latency_ms}ms) - ${message}`);
    } else {
      console.log(` ❌ Failed: ${message}`);
      process.exit(1);
    }
  } else if (subcommand === 'delete') {
    const id = args[1] || getArg(args, '--id');
    if (!id) {
      console.error('Usage: quantaseal integrations delete <integration-id>');
      process.exit(1);
    }
    const res = await apiRequest('DELETE', `/api/v2/proxy/integrations/${id}`);
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
    // This endpoint returns the evidence package directly (no {success,data}
    // envelope) and defaults to a PDF binary - request JSON explicitly to get
    // a package we can summarize on the terminal.
    const res = await apiRequest('POST', `/api/v2/compliance/report/${framework}?format=json`);
    checkSuccess(res, 'Compliance report');
    console.log(' done\n');

    const pkg = res.data;
    console.log(`Framework:    ${pkg.compliance?.framework?.toUpperCase() || framework.toUpperCase()}`);
    console.log(`Score:        ${pkg.compliance?.overall_score}/100`);
    console.log(`Period:       ${pkg.compliance?.period_days} days`);
    console.log(`Generated:    ${pkg.compliance?.generated_at}`);
    console.log(`Sample logs:  ${pkg.sample_audit_logs?.length ?? 0} audit events included as evidence`);
    console.log('');
    console.log('For the full PDF report (executive summary, control-by-control evidence, sample logs),');
    console.log(`use the admin console: app.quantaseal.io/compliance (PDF download is not yet supported in the CLI)`);
  } else if (subcommand === 'all') {
    console.log('Generating reports for all 9 frameworks...\n');
    for (const fw of FRAMEWORKS) {
      const res = await apiRequest('POST', `/api/v2/compliance/report/${fw}?format=json`);
      if (res.status < 400 && res.data?.compliance) {
        const score = res.data.compliance.overall_score;
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
    // The real endpoint only supports `limit` (1-100) - it does not filter
    // server-side by event type, time window, or outcome.
    const limit = getArg(args, '--limit') || '10';

    const res = await apiRequest('GET', `/api/v2/audit?limit=${limit}`);
    checkSuccess(res, 'Audit logs');
    const logs = res.data.data || [];
    if (logs.length === 0) {
      console.log('No audit events found.');
      return;
    }
    for (const log of logs) {
      const ts = new Date(log.timestamp).toLocaleString();
      const outcome = log.outcome === 'success' ? '✅' : log.outcome === 'failure' ? '❌' : '-';
      console.log(`${outcome}  ${ts}  ${String(log.eventType || '').padEnd(35)}  ${log.actor || 'system'}`);
    }
    console.log(`\n${logs.length} event(s)`);
  } else if (subcommand === 'verify-chain') {
    // Full cryptographic verification (hash chain + ML-DSA-65 signatures),
    // done server-side and returned as a report signed with the tenant's
    // own key - suitable as compliance/legal evidence, not just a client-
    // side sanity check. Requires an active Growth or Enterprise plan.
    const fromDate = getArg(args, '--from');
    const toDate = getArg(args, '--to');
    let qs = '';
    if (fromDate) qs += `${qs ? '&' : '?'}from_date=${encodeURIComponent(fromDate)}`;
    if (toDate) qs += `${qs ? '&' : '?'}to_date=${encodeURIComponent(toDate)}`;

    process.stdout.write('Verifying audit chain (hash + ML-DSA-65 signatures)...');
    const res = await apiRequest('GET', `/api/v2/audit/verify-integrity${qs}`);
    if (res.status === 403) {
      console.log('');
      console.error('❌ Audit chain verification requires an active Growth or Enterprise plan.');
      process.exit(1);
    }
    checkSuccess(res, 'Audit chain verification');
    const report = res.data.data;
    if (report.chain_valid && report.signatures_valid) {
      console.log(` ✅ valid (${report.entries_verified} entries verified)`);
    } else {
      console.log('');
      console.error(`❌ chain_valid=${report.chain_valid}  signatures_valid=${report.signatures_valid}`);
      process.exit(1);
    }
    if (report.unsigned_entries) {
      console.log(`   ⚠ ${report.unsigned_entries} unsigned entries in range (pre-dates ML-DSA-65 signing)`);
    }
    console.log(`   Verified at: ${report.verification_timestamp}`);
  } else {
    console.error('Usage: quantaseal audit logs [--limit 10]');
    console.error('       quantaseal audit verify-chain [--from ISO-8601] [--to ISO-8601]');
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
  encrypt --text <text> --out <f>   Encrypt plaintext (ML-KEM-768), save envelope
  decrypt --file <envelope.json>    Decrypt (needs the full envelope from encrypt)
  sign --text <data> --out <f>      Sign data (ML-DSA-65), save bundle
  verify --signature-file <f>       Verify a bundle produced by sign

Vault:
  vault list                        List all sealed credentials
  vault seal --name --type          Seal a new credential (max TTL 24h)
  vault unseal <entry-id>           Retrieve a sealed credential
  vault rotate <entry-id>           Re-seal existing value under a fresh key
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
  audit logs [--limit 10]                    Query immutable audit log (max 100)
  audit verify-chain [--from] [--to]         Server-side hash + ML-DSA-65 signature
                                              verification (Growth/Enterprise only)

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
