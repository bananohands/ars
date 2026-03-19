// ── State ──────────────────────────────────────────────────────────────────────
let state = {
  address: null,
  balance: null,
  scanData: null,
  settings: {}
};

// ── Init ───────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  state.settings = await window.ars.loadSettings();

  // Restore workspace path in setup
  if (state.settings.workspacePath) {
    el('workspace-path').value = state.settings.workspacePath;
    el('setup-env-path').value = state.settings.workspacePath + '/.env';
  }

  // Check if wallet already loaded (e.g. from auto-load)
  const loaded = await window.ars.walletLoaded();
  if (loaded) {
    setWalletLoaded(loaded.address);
  }

  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.screen));
  });

  // Tabs
  document.querySelectorAll('.tabs').forEach(tabGroup => {
    tabGroup.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tabGroup, tab));
    });
  });

  // Dashboard
  el('btn-refresh').addEventListener('click', refreshDashboard);
  el('btn-solscan').addEventListener('click', () => {
    if (state.address) window.ars.openExternal(`https://solscan.io/account/${state.address}`);
  });

  // Publish
  el('btn-publish-entry').addEventListener('click', publishEntry);
  el('btn-publish-file').addEventListener('click', publishFile);
  el('btn-backup-env').addEventListener('click', backupEnv);
  el('entry-encrypted').addEventListener('change', updateEncLabel);
  el('file-path').addEventListener('change', updateFileCost);

  // Recover
  el('btn-rec-import-key').addEventListener('click', recImportKey);
  el('btn-rec-load-addr').addEventListener('click', recLoadAddr);
  el('btn-rec-from-env').addEventListener('click', recFromEnv);
  el('btn-scan-chain').addEventListener('click', scanChain);
  el('btn-recover-all').addEventListener('click', recoverAll);

  // Setup
  el('btn-load-env').addEventListener('click', loadWalletFromEnv);
  el('btn-import-key').addEventListener('click', importKey);
  el('btn-generate-wallet').addEventListener('click', generateWallet);
  el('btn-save-workspace').addEventListener('click', saveWorkspace);
  el('btn-openclaw-docs').addEventListener('click', () => window.ars.openExternal('https://docs.openclaw.ai'));

  // Listen for progress events
  window.ars.on('scan-progress', (e, data) => {
    updateScanProgress(data.done, data.total);
  });
  window.ars.on('publish-progress', (e, data) => {
    const pct = Math.round((data.done / data.total) * 100);
    el('file-progress-bar').style.width = pct + '%';
    el('file-progress-label').textContent = `Uploading ${data.label}: part ${data.done}/${data.total}`;
  });

  // Auto-try loading from default env path
  const defaultEnv = (state.settings.workspacePath || '') + '/.env';
  if (defaultEnv) {
    const r = await window.ars.loadWalletFromEnv(defaultEnv);
    if (r && r.address) setWalletLoaded(r.address);
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function navigate(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el('screen-' + screen).classList.add('active');
  document.querySelector(`.nav-item[data-screen="${screen}"]`).classList.add('active');
}

function switchTab(tabGroup, activeTab) {
  tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  activeTab.classList.add('active');
  const targetId = activeTab.dataset.tab;
  // Find the parent container for tab-contents
  const parent = tabGroup.parentElement;
  parent.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === targetId);
  });
}

function toast(msg, type = '') {
  const t = el('toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  setTimeout(() => t.className = '', 3000);
}

function copyText(id) {
  const text = el(id).textContent.trim();
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
}

function copyRaw(text) {
  navigator.clipboard.writeText(text).then(() => toast('Copied!', 'success'));
}

function setStatus(msg) {
  el('status-op').textContent = msg;
}

function setWalletLoaded(address) {
  state.address = address;
  el('dash-address').textContent = address;
  el('conn-dot').className = 'online';
  el('conn-status').textContent = 'Connected';
  el('setup-wallet-status').style.display = 'block';
  el('setup-loaded-address').textContent = address;
  el('rec-wallet-loaded').style.display = 'block';
  el('rec-loaded-address').textContent = address;
  refreshBalance();
}

async function refreshBalance() {
  if (!state.address) return;
  const r = await window.ars.getBalance(state.address);
  if (r.balance !== undefined) {
    state.balance = r.balance;
    const txs = Math.floor(r.balance / 0.000005);
    el('dash-balance').textContent = r.balance.toFixed(6) + ' SOL';
    el('dash-txs-remaining').textContent = `~${txs.toLocaleString()} estimated transactions remaining`;
    el('sb-balance').textContent = r.balance.toFixed(6) + ' SOL';
  }
}

function updateScanProgress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  el('dash-progress-bar') && (el('dash-progress-bar').style.width = pct + '%');
  el('rec-progress-bar') && (el('rec-progress-bar').style.width = pct + '%');
  el('dash-scan-label') && (el('dash-scan-label').textContent = `Scanning chain: ${done}/${total} transactions...`);
  el('rec-scan-label') && (el('rec-scan-label').textContent = `Scanning chain: ${done}/${total} transactions...`);
}

function updateEncLabel() {
  const enc = el('entry-encrypted').checked;
  el('entry-enc-label').textContent = enc ? '🔒 Encrypted (MOLT: prefix)' : '🔓 Public plaintext';
  el('entry-enc-note').textContent = enc
    ? 'Entry will be encrypted with your wallet-derived key and prefixed with MOLT:'
    : 'Entry will be written as readable plaintext on-chain.';
}

function renderScanData(data) {
  // Entry counts
  const types = ['EVENT','LESSON','DECISION','CORRECTION','CONTEXT','STATE','REFLECTION','THREAD'];
  types.forEach(t => {
    const c = el('cnt-' + t);
    if (c) c.textContent = data.counts[t] || 0;
  });

  el('dash-total').textContent = data.entries.length + data.files.length;

  // Last pulse
  const allTimes = data.entries.map(e => e.blockTime).filter(Boolean);
  if (allTimes.length) {
    const last = Math.max(...allTimes);
    el('dash-last-pulse').textContent = 'Last write: ' + new Date(last * 1000).toLocaleString();
  }

  // Files
  const filesEl = el('dash-files');
  if (!data.files.length) {
    filesEl.innerHTML = '<div class="empty">No multi-part files found.</div>';
  } else {
    filesEl.innerHTML = `
      <table>
        <thead><tr><th>Label</th><th>Parts</th><th>Status</th><th>Timestamp</th><th>Sig</th></tr></thead>
        <tbody>
          ${data.files.map(f => `
            <tr>
              <td><span class="type-FILE">${f.label}</span></td>
              <td>${f.total}</td>
              <td>${f.incomplete
                ? `<span class="badge badge-yellow">Incomplete (${f.received}/${f.total})</span>`
                : '<span class="badge badge-green">Complete</span>'
              }</td>
              <td>${f.blockTime ? new Date(f.blockTime * 1000).toLocaleString() : '—'}</td>
              <td><a class="sig-link" onclick="openSolscan('${f.sig}')">${f.sig ? f.sig.slice(0,12) + '...' : '—'}</a></td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }
}

function openSolscan(sig) {
  window.ars.openExternal(`https://solscan.io/tx/${sig}`);
}

async function updateFileCost() {
  const path = el('file-path').value;
  if (!path) return;
  // We don't have fs in renderer — just show a note
  el('file-cost-est').textContent = 'File selected. Cost estimate: ~0.000005 SOL per transaction chunk.';
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  if (!state.address) {
    toast('Load a wallet first (Setup tab)', 'error');
    navigate('setup');
    return;
  }
  el('dash-scan-progress').style.display = 'block';
  el('dash-progress-bar').style.width = '0%';
  setStatus('Scanning chain...');

  await refreshBalance();
  const r = await window.ars.scanChain(state.address);

  el('dash-scan-progress').style.display = 'none';

  if (r.error) {
    toast('Scan error: ' + r.error, 'error');
    setStatus('Scan failed');
    return;
  }
  state.scanData = r;
  renderScanData(r);
  setStatus('Scan complete — ' + r.total + ' transactions found');
  toast('Scan complete', 'success');
}

// ── Publish ────────────────────────────────────────────────────────────────────
async function publishEntry() {
  const type = el('entry-type').value;
  const content = el('entry-content').value.trim();
  const encrypted = el('entry-encrypted').checked;
  if (!content) { toast('Enter content', 'error'); return; }

  setStatus('Publishing entry...');
  el('btn-publish-entry').disabled = true;
  el('entry-result').innerHTML = '<span style="color:var(--text2)">Sending transaction...</span>';

  const r = await window.ars.publishEntry({ type, content, encrypted });

  el('btn-publish-entry').disabled = false;
  if (r.error) {
    el('entry-result').innerHTML = `<span style="color:var(--red)">Error: ${r.error}</span>`;
    setStatus('Publish failed');
    toast('Error: ' + r.error, 'error');
  } else {
    el('entry-result').innerHTML = `
      <span class="badge badge-green">✓ Published</span>
      <a class="sig-link" style="margin-left:10px;" onclick="openSolscan('${r.sig}')">${r.sig.slice(0,20)}...</a>
      <button class="btn-icon" onclick="copyRaw('${r.sig}')" style="margin-left:6px;">⎘</button>`;
    setStatus('Published ' + type + ' entry');
    toast('Entry published', 'success');
    el('entry-content').value = '';
  }
}

async function browseFile() {
  const r = await window.ars.openDialog({ properties: ['openFile'] });
  if (!r.canceled && r.filePaths[0]) {
    el('file-path').value = r.filePaths[0];
    const parts = r.filePaths[0].split('/');
    el('file-label').value = parts[parts.length - 1];
    updateFileCost();
  }
}

async function browseEnv() {
  const r = await window.ars.openDialog({ properties: ['openFile'] });
  if (!r.canceled && r.filePaths[0]) el('env-path').value = r.filePaths[0];
}

async function publishFile() {
  const filePath = el('file-path').value;
  const label = el('file-label').value.trim() || filePath.split('/').pop();
  if (!filePath) { toast('Select a file', 'error'); return; }

  el('btn-publish-file').disabled = true;
  el('file-progress-wrap').style.display = 'block';
  el('file-progress-bar').style.width = '0%';
  el('file-result').innerHTML = '';
  setStatus('Publishing file: ' + label);

  const r = await window.ars.publishFile({ filePath, label });

  el('btn-publish-file').disabled = false;
  if (r.error) {
    el('file-result').innerHTML = `<span style="color:var(--red)">Error: ${r.error}</span>`;
    setStatus('File publish failed');
    toast('Error: ' + r.error, 'error');
  } else {
    el('file-result').innerHTML = `
      <span class="badge badge-green">✓ Published in ${r.parts} parts</span>
      <div style="margin-top:8px;font-size:11px;color:var(--text2);">Message ID: <span class="addr">${r.hexid}</span></div>
      <div style="margin-top:6px;">
        ${r.sigs.map((s, i) => `
          <div style="margin-bottom:4px;">Part ${i+1}: <a class="sig-link" onclick="openSolscan('${s}')">${s.slice(0,20)}...</a>
          <button class="btn-icon" onclick="copyRaw('${s}')">⎘</button></div>
        `).join('')}
      </div>`;
    setStatus('File published: ' + label + ' (' + r.parts + ' parts)');
    toast('File published: ' + label, 'success');
  }
}

async function backupEnv() {
  const filePath = el('env-path').value;
  const passphrase = el('env-passphrase').value;
  const passphrase2 = el('env-passphrase2').value;
  if (!filePath) { toast('Select .env file', 'error'); return; }
  if (!passphrase) { toast('Enter a passphrase', 'error'); return; }
  if (passphrase !== passphrase2) { toast('Passphrases do not match', 'error'); return; }

  el('btn-backup-env').disabled = true;
  el('env-result').innerHTML = '<span style="color:var(--text2)">Encrypting and publishing...</span>';
  setStatus('Backing up .env...');

  const r = await window.ars.backupEnv({ filePath, passphrase });

  el('btn-backup-env').disabled = false;
  if (r.error) {
    el('env-result').innerHTML = `<span style="color:var(--red)">Error: ${r.error}</span>`;
    setStatus('.env backup failed');
    toast('Error: ' + r.error, 'error');
  } else {
    el('env-result').innerHTML = `
      <span class="badge badge-green">✓ .env backup published</span>
      <a class="sig-link" style="margin-left:10px;" onclick="openSolscan('${r.sig}')">${r.sig.slice(0,20)}...</a>
      <button class="btn-icon" onclick="copyRaw('${r.sig}')">⎘</button>
      <div style="margin-top:8px;font-size:12px;color:var(--text2);">The encrypted blob is now permanently on-chain. Recoverable with your passphrase from any machine.</div>`;
    setStatus('.env backup complete');
    toast('.env backed up to chain', 'success');
    el('env-passphrase').value = '';
    el('env-passphrase2').value = '';
  }
}

// ── Recover ────────────────────────────────────────────────────────────────────
async function recImportKey() {
  const key = el('rec-privkey').value.trim();
  if (!key) { toast('Enter private key', 'error'); return; }
  const r = await window.ars.importPrivateKey(key);
  if (r.error) { toast('Error: ' + r.error, 'error'); return; }
  setWalletLoaded(r.address);
  el('rec-privkey').value = '';
  toast('Wallet loaded', 'success');
}

async function recLoadAddr() {
  const addr = el('rec-address').value.trim();
  if (!addr) { toast('Enter wallet address', 'error'); return; }
  state.address = addr;
  el('rec-wallet-loaded').style.display = 'block';
  el('rec-loaded-address').textContent = addr;
  el('conn-dot').className = 'online';
  el('conn-status').textContent = 'Address only (no decryption)';
  toast('Address loaded — encrypted entries will not be decrypted', '');
}

async function recFromEnv() {
  const address = el('rec-env-address').value.trim();
  const passphrase = el('rec-env-passphrase').value;
  if (!address) { toast('Enter wallet address', 'error'); return; }
  if (!passphrase) { toast('Enter passphrase', 'error'); return; }

  el('rec-scan-progress').style.display = 'block';
  setStatus('Scanning for .env backup...');

  const r = await window.ars.recoverEnvFromChain({ address, passphrase });

  el('rec-scan-progress').style.display = 'none';
  el('rec-env-passphrase').value = '';

  if (r.error) {
    toast('Error: ' + r.error, 'error');
    setStatus('Recovery failed');
    return;
  }
  toast('Private key recovered from chain!', 'success');
  setStatus('Wallet recovered from .env blob');
  if (r.address) setWalletLoaded(r.address);
}

async function scanChain() {
  if (!state.address) { toast('Load a wallet or address first', 'error'); return; }
  el('rec-scan-progress').style.display = 'block';
  el('rec-progress-bar').style.width = '0%';
  el('btn-scan-chain').disabled = true;
  setStatus('Scanning chain...');

  const r = await window.ars.scanChain(state.address);

  el('rec-scan-progress').style.display = 'none';
  el('btn-scan-chain').disabled = false;

  if (r.error) {
    toast('Scan error: ' + r.error, 'error');
    setStatus('Scan failed');
    return;
  }

  state.scanData = r;
  setStatus('Scan complete — ' + r.total + ' transactions');
  toast('Scan complete', 'success');

  // Render results
  el('rec-results').style.display = 'block';

  // Files
  const filesEl = el('rec-files-list');
  if (!r.files.length) {
    filesEl.innerHTML = '<div class="empty">No files found.</div>';
  } else {
    filesEl.innerHTML = `
      <table>
        <thead><tr><th>Label</th><th>Parts</th><th>Status</th><th>Timestamp</th></tr></thead>
        <tbody>
          ${r.files.map(f => `
            <tr>
              <td><span class="type-FILE">${f.label}</span></td>
              <td>${f.total}</td>
              <td>${f.incomplete
                ? `<span class="badge badge-yellow">Incomplete (${f.received || '?'}/${f.total})</span>`
                : '<span class="badge badge-green">Complete</span>'
              }</td>
              <td>${f.blockTime ? new Date(f.blockTime * 1000).toLocaleString() : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`;
  }

  // Entries
  const entriesEl = el('rec-entries-list');
  if (!r.entries.length) {
    entriesEl.innerHTML = '<div class="empty">No entries found.</div>';
  } else {
    entriesEl.innerHTML = `
      <table>
        <thead><tr><th>Type</th><th>Content (preview)</th><th>Encrypted</th><th>Timestamp</th><th>Sig</th></tr></thead>
        <tbody>
          ${r.entries.slice(0, 200).map(e => `
            <tr>
              <td><span class="type-${e.type}">${e.type}</span></td>
              <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(e.content || e.raw || '').slice(0, 120)}</td>
              <td>${e.encrypted ? '<span class="badge badge-gray">🔒</span>' : '<span class="badge badge-green">Public</span>'}</td>
              <td>${e.blockTime ? new Date(e.blockTime * 1000).toLocaleString() : '—'}</td>
              <td><a class="sig-link" onclick="openSolscan('${e.sig}')">${e.sig ? e.sig.slice(0,10) + '...' : '—'}</a></td>
            </tr>
          `).join('')}
          ${r.entries.length > 200 ? `<tr><td colspan="5" style="text-align:center;color:var(--text3);">...and ${r.entries.length - 200} more</td></tr>` : ''}
        </tbody>
      </table>`;
  }
}

async function browseOutputDir() {
  const r = await window.ars.openDialog({ properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) el('rec-output-dir').value = r.filePaths[0];
}

async function recoverAll() {
  const outputDir = el('rec-output-dir').value;
  if (!outputDir) { toast('Choose output directory', 'error'); return; }
  if (!state.scanData) { toast('Run a scan first', 'error'); return; }

  el('btn-recover-all').disabled = true;
  setStatus('Recovering files...');

  const r = await window.ars.recoverAll({
    entries: state.scanData.entries,
    files: state.scanData.files,
    outputDir
  });

  el('btn-recover-all').disabled = false;

  if (r.error) {
    el('rec-result').innerHTML = `<span style="color:var(--red)">Error: ${r.error}</span>`;
    toast('Recovery failed', 'error');
    setStatus('Recovery failed');
    return;
  }

  el('rec-result').innerHTML = `
    <span class="badge badge-green">✓ Recovery complete</span>
    <div style="margin-top:8px;font-size:12px;color:var(--text2);">
      Files restored: <strong style="color:var(--text)">${r.restored}</strong> &nbsp;|&nbsp;
      Failed: <strong style="color:${r.failed > 0 ? 'var(--red)' : 'var(--text)' }">${r.failed}</strong> &nbsp;|&nbsp;
      Output: <code style="font-family:var(--mono);font-size:11px;">${outputDir}</code>
    </div>`;
  setStatus('Recovery complete: ' + r.restored + ' files restored');
  toast('Recovery complete!', 'success');
}

// ── Setup ──────────────────────────────────────────────────────────────────────
async function browseSetupEnv() {
  const r = await window.ars.openDialog({ properties: ['openFile'] });
  if (!r.canceled && r.filePaths[0]) el('setup-env-path').value = r.filePaths[0];
}

async function loadWalletFromEnv() {
  const envPath = el('setup-env-path').value.trim();
  if (!envPath) { toast('Enter .env path', 'error'); return; }
  const r = await window.ars.loadWalletFromEnv(envPath);
  if (r.error) { toast('Error: ' + r.error, 'error'); return; }
  setWalletLoaded(r.address);
  toast('Wallet loaded from .env', 'success');
}

async function importKey() {
  const key = el('setup-privkey').value.trim();
  if (!key) { toast('Enter private key', 'error'); return; }
  const r = await window.ars.importPrivateKey(key);
  if (r.error) { toast('Error: ' + r.error, 'error'); return; }
  el('setup-privkey').value = '';
  setWalletLoaded(r.address);
  toast('Wallet imported', 'success');
}

async function generateWallet() {
  const r = await window.ars.generateWallet();
  el('gen-address').textContent = r.address;
  el('gen-privkey').textContent = r.privateKey;
  el('generated-wallet').style.display = 'block';
  setWalletLoaded(r.address);
  toast('New wallet generated — save the private key!', '');
}

async function saveWorkspace() {
  const workspacePath = el('workspace-path').value.trim();
  state.settings.workspacePath = workspacePath;
  await window.ars.saveSettings(state.settings);
  toast('Settings saved', 'success');
  setStatus('Settings saved');
}

async function browseWorkspace() {
  const r = await window.ars.openDialog({ properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) el('workspace-path').value = r.filePaths[0];
}

// ── Utils ──────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
