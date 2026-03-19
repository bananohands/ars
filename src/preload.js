const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ars', {
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (s) => ipcRenderer.invoke('save-settings', s),
  loadWalletFromEnv: (p) => ipcRenderer.invoke('load-wallet-from-env', p),
  importPrivateKey: (k) => ipcRenderer.invoke('import-private-key', k),
  generateWallet: () => ipcRenderer.invoke('generate-wallet'),
  getBalance: (a) => ipcRenderer.invoke('get-balance', a),
  scanChain: (a) => ipcRenderer.invoke('scan-chain', a),
  publishEntry: (d) => ipcRenderer.invoke('publish-entry', d),
  publishFile: (d) => ipcRenderer.invoke('publish-file', d),
  backupEnv: (d) => ipcRenderer.invoke('backup-env', d),
  recoverEnvFromChain: (d) => ipcRenderer.invoke('recover-env-from-chain', d),
  recoverAll: (d) => ipcRenderer.invoke('recover-all', d),
  openDialog: (o) => ipcRenderer.invoke('open-dialog', o),
  saveDialog: (o) => ipcRenderer.invoke('save-dialog', o),
  openExternal: (u) => ipcRenderer.invoke('open-external', u),
  walletLoaded: () => ipcRenderer.invoke('wallet-loaded'),
  on: (ch, fn) => ipcRenderer.on(ch, fn),
  off: (ch, fn) => ipcRenderer.removeListener(ch, fn),
});
