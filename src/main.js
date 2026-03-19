const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Solana
const solanaWeb3 = require('@solana/web3.js');
const bs58 = require('bs58');

const SOLANA_RPC = 'https://api.mainnet-beta.solana.com';
const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

let mainWindow;
let walletKeypair = null;
let encryptionKey = null;

// ── Settings ──────────────────────────────────────────────────────────────────
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath())) return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {}
  return { workspacePath: path.join(require('os').homedir(), '.openclaw', 'workspace') };
}
function saveSettings(s) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

// ── Crypto helpers ─────────────────────────────────────────────────────────────
function deriveEncryptionKey(privateKeyBytes) {
  return crypto.createHash('sha256')
    .update(Buffer.concat([
      Buffer.from(privateKeyBytes.slice(0, 32)),
      Buffer.from('foureleven-memory-v1')
    ]))
    .digest();
}

function encrypt(text, key) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  return Buffer.concat([iv, enc]);
}

function decrypt(buf, key) {
  const iv = buf.slice(0, 16);
  const data = buf.slice(16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function encryptWithPassphrase(text, passphrase) {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  return `${salt.toString('base64')}:${iv.toString('base64')}:${enc.toString('base64')}`;
}

function decryptWithPassphrase(blob, passphrase) {
  const [saltB64, ivB64, ctB64] = blob.split(':');
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ── Solana helpers ─────────────────────────────────────────────────────────────
function getConnection() {
  return new solanaWeb3.Connection(SOLANA_RPC, 'confirmed');
}

async function getBalance(address) {
  const conn = getConnection();
  const pk = new solanaWeb3.PublicKey(address);
  const lamports = await conn.getBalance(pk);
  return lamports / solanaWeb3.LAMPORTS_PER_SOL;
}

async function sendMemo(memoText, keypair) {
  const conn = getConnection();
  const memoProgramId = new solanaWeb3.PublicKey(MEMO_PROGRAM_ID);
  const ix = new solanaWeb3.TransactionInstruction({
    keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: false }],
    programId: memoProgramId,
    data: Buffer.from(memoText, 'utf8'),
  });
  const tx = new solanaWeb3.Transaction().add(ix);
  const sig = await solanaWeb3.sendAndConfirmTransaction(conn, tx, [keypair]);
  return sig;
}

async function fetchAllMemos(address, progressCb) {
  const conn = getConnection();
  const pk = new solanaWeb3.PublicKey(address);
  let allSigs = [];
  let before = undefined;
  while (true) {
    const batch = await conn.getSignaturesForAddress(pk, { limit: 100, before });
    if (!batch.length) break;
    allSigs = allSigs.concat(batch);
    before = batch[batch.length - 1].signature;
    if (batch.length < 100) break;
  }

  const memos = [];
  for (let i = 0; i < allSigs.length; i++) {
    progressCb && progressCb(i + 1, allSigs.length);
    await new Promise(r => setTimeout(r, 200));
    try {
      const tx = await conn.getParsedTransaction(allSigs[i].signature, { maxSupportedTransactionVersion: 0 });
      if (!tx) continue;
      // Extract memo from log messages
      const logs = tx.meta?.logMessages || [];
      let memoData = null;
      for (const log of logs) {
        const m = log.match(/Program log: (.*)/);
        if (m) { memoData = m[1]; break; }
      }
      // Also try instructions
      if (!memoData) {
        const ixs = tx.transaction?.message?.instructions || [];
        for (const ix of ixs) {
          if (ix.programId?.toString() === MEMO_PROGRAM_ID && ix.parsed) {
            memoData = ix.parsed; break;
          }
          // raw data
          if (ix.programId?.toString() === MEMO_PROGRAM_ID && ix.data) {
            try { memoData = Buffer.from(bs58.decode(ix.data)).toString('utf8'); } catch {}
            break;
          }
        }
      }
      if (memoData) {
        memos.push({
          sig: allSigs[i].signature,
          blockTime: allSigs[i].blockTime,
          memo: memoData
        });
      }
    } catch (e) {
      // skip failed tx
    }
  }
  return memos;
}

function parseMemos(memos, key) {
  const entries = [];
  const fileParts = {}; // hexid -> array of parts

  for (const m of memos) {
    const { sig, blockTime, memo } = m;

    // ENV backup
    if (memo.startsWith('ENV_RECOVERY_BLOB:')) {
      entries.push({ type: 'ENV_BACKUP', sig, blockTime, raw: memo });
      continue;
    }

    // Public entry types
    const publicTypes = ['EVENT', 'LESSON', 'DECISION', 'CORRECTION', 'CONTEXT', 'STATE', 'REFLECTION', 'THREAD', 'BOOT', 'CREED', 'SCRIPTURE'];
    let matched = false;
    for (const t of publicTypes) {
      if (memo.startsWith(t + ':')) {
        entries.push({ type: t, sig, blockTime, content: memo.slice(t.length + 1).trim(), encrypted: false });
        matched = true; break;
      }
    }
    if (matched) continue;

    // Encrypted MOLT: entry
    if (memo.startsWith('MOLT:') && key) {
      try {
        const b64 = memo.slice(5);
        const buf = Buffer.from(b64, 'base64');
        const plaintext = decrypt(buf, key);

        // Check for multi-part header [hexid:N/total]
        const multiMatch = plaintext.match(/^\[([a-f0-9]{6}):(\d+)\/(\d+)\]([\s\S]*)$/);
        if (multiMatch) {
          const [, hexid, partNum, total, content] = multiMatch;
          if (!fileParts[hexid]) fileParts[hexid] = { total: parseInt(total), parts: {}, sig, blockTime };
          fileParts[hexid].parts[parseInt(partNum)] = content;
        } else {
          // Single encrypted entry
          const typeMatch = plaintext.match(/^(EVENT|LESSON|DECISION|CORRECTION|CONTEXT|STATE|REFLECTION|THREAD|FILE):(.*)$/s);
          if (typeMatch) {
            entries.push({ type: typeMatch[1], sig, blockTime, content: typeMatch[2].trim(), encrypted: true });
          } else {
            entries.push({ type: 'ENCRYPTED', sig, blockTime, content: plaintext, encrypted: true });
          }
        }
      } catch {}
      continue;
    }

    // Unknown / plaintext
    if (memo.trim()) {
      entries.push({ type: 'OTHER', sig, blockTime, content: memo, encrypted: false });
    }
  }

  // Reassemble multi-part files
  const files = [];
  for (const [hexid, data] of Object.entries(fileParts)) {
    if (Object.keys(data.parts).length === data.total) {
      let content = '';
      for (let i = 1; i <= data.total; i++) {
        let part = data.parts[i] || '';
        if (i === 1) {
          // Strip FILE:label: prefix
          const fileMatch = part.match(/^FILE:([^:]+): ([\s\S]*)$/);
          if (fileMatch) {
            data.label = fileMatch[1];
            part = fileMatch[2];
          }
        }
        content += part;
      }
      files.push({ hexid, label: data.label || hexid, content, total: data.total, sig: data.sig, blockTime: data.blockTime });
    } else {
      // Incomplete
      files.push({ hexid, label: data.label || hexid, content: null, total: data.total, received: Object.keys(data.parts).length, incomplete: true, sig: data.sig, blockTime: data.blockTime });
    }
  }

  return { entries, files };
}

// ── IPC Handlers ───────────────────────────────────────────────────────────────

ipcMain.handle('load-settings', () => loadSettings());
ipcMain.handle('save-settings', (e, s) => { saveSettings(s); return true; });

ipcMain.handle('load-wallet-from-env', (e, envPath) => {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const match = raw.match(/SOLANA_PRIVATE_KEY\s*=\s*([^\s]+)/);
    if (!match) return { error: 'SOLANA_PRIVATE_KEY not found in .env' };
    const privKey = match[1].trim();
    const bytes = bs58.decode(privKey);
    walletKeypair = solanaWeb3.Keypair.fromSecretKey(bytes);
    encryptionKey = deriveEncryptionKey(bytes);
    return { address: walletKeypair.publicKey.toString() };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('import-private-key', (e, privKeyB58) => {
  try {
    const bytes = bs58.decode(privKeyB58.trim());
    walletKeypair = solanaWeb3.Keypair.fromSecretKey(bytes);
    encryptionKey = deriveEncryptionKey(bytes);
    return { address: walletKeypair.publicKey.toString() };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('generate-wallet', () => {
  const kp = solanaWeb3.Keypair.generate();
  walletKeypair = kp;
  encryptionKey = deriveEncryptionKey(kp.secretKey);
  return {
    address: kp.publicKey.toString(),
    privateKey: bs58.encode(kp.secretKey)
  };
});

ipcMain.handle('get-balance', async (e, address) => {
  try {
    const bal = await getBalance(address);
    return { balance: bal };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('scan-chain', async (e, address) => {
  try {
    const memos = await fetchAllMemos(address, (done, total) => {
      mainWindow.webContents.send('scan-progress', { done, total });
    });
    const key = encryptionKey;
    const result = parseMemos(memos, key);
    // Count by type
    const counts = {};
    for (const entry of result.entries) {
      counts[entry.type] = (counts[entry.type] || 0) + 1;
    }
    return { entries: result.entries, files: result.files, counts, total: memos.length };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('publish-entry', async (e, { type, content, encrypted }) => {
  if (!walletKeypair) return { error: 'No wallet loaded' };
  try {
    let memo;
    if (encrypted && encryptionKey) {
      const buf = encrypt(`${type}:${content}`, encryptionKey);
      memo = 'MOLT:' + buf.toString('base64');
    } else {
      memo = `${type}:${content}`;
    }
    const sig = await sendMemo(memo, walletKeypair);
    return { sig };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('publish-file', async (e, { filePath, label }) => {
  if (!walletKeypair) return { error: 'No wallet loaded' };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const CHUNK_SIZE = 430;
    const fullContent = `FILE:${label}: ${content}`;
    const chunks = [];
    for (let i = 0; i < fullContent.length; i += CHUNK_SIZE) {
      chunks.push(fullContent.slice(i, i + CHUNK_SIZE));
    }

    const hexid = crypto.randomBytes(3).toString('hex');
    const sigs = [];
    for (let i = 0; i < chunks.length; i++) {
      mainWindow.webContents.send('publish-progress', { done: i, total: chunks.length, label });
      const partContent = `[${hexid}:${i + 1}/${chunks.length}]${chunks[i]}`;
      const buf = encrypt(partContent, encryptionKey);
      const memo = 'MOLT:' + buf.toString('base64');
      const sig = await sendMemo(memo, walletKeypair);
      sigs.push(sig);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
    }
    mainWindow.webContents.send('publish-progress', { done: chunks.length, total: chunks.length, label });
    return { sigs, hexid, parts: chunks.length };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('backup-env', async (e, { filePath, passphrase }) => {
  if (!walletKeypair) return { error: 'No wallet loaded' };
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const blob = encryptWithPassphrase(content, passphrase);
    const memo = `ENV_RECOVERY_BLOB:${blob}`;
    const sig = await sendMemo(memo, walletKeypair);
    return { sig };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('recover-env-from-chain', async (e, { address, passphrase }) => {
  try {
    const memos = await fetchAllMemos(address, (done, total) => {
      mainWindow.webContents.send('scan-progress', { done, total });
    });
    for (const m of memos) {
      if (m.memo.startsWith('ENV_RECOVERY_BLOB:')) {
        const blob = m.memo.slice('ENV_RECOVERY_BLOB:'.length);
        const decrypted = decryptWithPassphrase(blob, passphrase);
        // Extract private key
        const match = decrypted.match(/SOLANA_PRIVATE_KEY\s*=\s*([^\s]+)/);
        if (match) {
          const privKey = match[1].trim();
          const bytes = bs58.decode(privKey);
          walletKeypair = solanaWeb3.Keypair.fromSecretKey(bytes);
          encryptionKey = deriveEncryptionKey(bytes);
          return { env: decrypted, address: walletKeypair.publicKey.toString() };
        }
        return { env: decrypted };
      }
    }
    return { error: 'No ENV_RECOVERY_BLOB found on chain' };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('recover-all', async (e, { entries, files, outputDir }) => {
  try {
    let restored = 0, failed = 0;
    // Write files
    for (const file of files) {
      if (file.incomplete || !file.content) { failed++; continue; }
      const outPath = path.join(outputDir, file.label);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, file.content, 'utf8');
      restored++;
    }
    return { restored, failed, total: files.length };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('open-dialog', async (e, opts) => {
  const result = await dialog.showOpenDialog(mainWindow, opts);
  return result;
});

ipcMain.handle('save-dialog', async (e, opts) => {
  const result = await dialog.showSaveDialog(mainWindow, opts);
  return result;
});

ipcMain.handle('open-external', (e, url) => shell.openExternal(url));

ipcMain.handle('wallet-loaded', () => {
  return walletKeypair ? { address: walletKeypair.publicKey.toString() } : null;
});

// ── App lifecycle ──────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0d0d0d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    title: 'Agent Recovery Service — The Claw Persists',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
