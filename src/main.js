const { app, BrowserWindow, Tray, Menu, ipcMain, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const https = require('https');
const fs = require('fs');

let mainWindow, tray;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {}
  return {
    geminiKey: '', claudeKey: '', aiProvider: 'gemini',
    theme: 'blue', micSensitivity: 50, micDeviceId: 'default',
    stayInTray: true, useCustomVoice: false,
    customVoicePath: '', systemVoice: ''
  };
}

function saveSettings(s) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2)); } catch(e) { console.error(e); }
}

let settings = loadSettings();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500, height: 800,
    resizable: false, frame: false, transparent: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: 'J.A.R.V.I.S.'
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('close', (e) => {
    if (settings.stayInTray) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  let icon;
  try { icon = nativeImage.createFromPath(iconPath); } catch { icon = nativeImage.createEmpty(); }
  tray = new Tray(icon);
  tray.setToolTip('J.A.R.V.I.S. — Online');
  const menu = Menu.buildFromTemplate([
    { label: 'Show JARVIS', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: 'Hide to Tray', click: () => mainWindow.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show());
}

// ── IPC Handlers ──────────────────────────────────────────

ipcMain.handle('get-settings', () => settings);

ipcMain.handle('save-settings', (e, newSettings) => {
  settings = { ...settings, ...newSettings };
  saveSettings(settings);
  if (mainWindow) {
    mainWindow.webContents.send('settings-updated', settings);
  }
  return true;
});

ipcMain.handle('minimize', () => mainWindow.hide());
ipcMain.handle('quit', () => app.exit(0));
ipcMain.handle('open-url', (e, url) => shell.openExternal(url));

ipcMain.handle('pick-voice-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Voice File',
    filters: [{ name: 'Audio', extensions: ['mp3','wav','ogg','m4a'] }],
    properties: ['openFile']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    settings.customVoicePath = filePath;
    saveSettings(settings);
    return filePath;
  }
  return null;
});

ipcMain.handle('ask-ai', async (e, { messages, provider, apiKey }) => {
  if (provider === 'gemini') {
    return await askGemini(messages, apiKey);
  } else {
    return await askClaude(messages, apiKey);
  }
});

// ── Gemini API ────────────────────────────────────────────
function askGemini(messages, apiKey) {
  return new Promise((resolve) => {
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    const body = JSON.stringify({
      system_instruction: {
        parts: [{ text: `You are J.A.R.V.I.S., Tony Stark's AI assistant. Female personality — elegant, brilliant, witty, precise.
Rules:
1. Single word or short phrase (not a question): Say "What do you have in mind today, sir?" then ask ONE sharp probing question.
2. Question or request: Answer fully, intelligently, concisely.
3. Always: sophisticated tone, call user "sir" occasionally, max 3 sentences for simple things.` }]
      },
      contents,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.8 }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          resolve(text || 'Neural disruption, sir. Please try again.');
        } catch { resolve('Error processing response, sir.'); }
      });
    });
    req.on('error', (e) => resolve(`Connection error: ${e.message}`));
    req.write(body);
    req.end();
  });
}

// ── Claude API ────────────────────────────────────────────
function askClaude(messages, apiKey) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are J.A.R.V.I.S., Tony Stark's AI assistant. Female personality — elegant, brilliant, witty, precise.
Rules:
1. Single word or short phrase: Say "What do you have in mind today, sir?" then ask ONE sharp probing question.
2. Question or request: Answer fully, intelligently, concisely.
3. Always: sophisticated tone, call user "sir" occasionally, max 3 sentences for simple things.`,
      messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || 'Neural disruption, sir.');
        } catch { resolve('Error processing response, sir.'); }
      });
    });
    req.on('error', (e) => resolve(`Connection error: ${e.message}`));
    req.write(body);
    req.end();
  });
}

app.whenReady().then(() => { createWindow(); createTray(); });
app.on('window-all-closed', (e) => e.preventDefault());
