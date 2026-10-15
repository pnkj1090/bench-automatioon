// Mock Server and UI Host for Opportunistic Placement & Automation Controller

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mockService } from './mock-service.js';
import { DemandAutomationEngine } from './engine.js';
import { CONFIG } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Create the automation engine instance embedded in server
const engine = new DemandAutomationEngine({
  target: 'mock',
  baseUrl: `http://localhost:${PORT}`,
  intervalMs: CONFIG.pollIntervalMs,
  mockService
});

// Helper for parsing JSON bodies
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // --- API ROUTES ---

  // 1. GET /api/data/filter
  if (pathname === '/api/data/filter' && method === 'GET') {
    return sendJson(res, 200, mockService.getFilterMetadata());
  }

  // 2. POST /api/demand/fetchDemands
  if (pathname === '/api/demand/fetchDemands' && method === 'POST') {
    const filters = await parseBody(req);
    const data = mockService.fetchDemands(filters);
    return sendJson(res, 200, data);
  }

  // 3. POST /api/demand/file
  if (pathname === '/api/demand/file' && method === 'POST') {
    const identifier = parsedUrl.searchParams.get('identifier') || 'upload';
    const uploadRes = mockService.uploadResume(identifier);
    return sendJson(res, 200, uploadRes);
  }

  // 4. POST /api/demand/:id/interest
  const interestMatch = pathname.match(/^\/api\/demand\/([^/]+)\/interest$/);
  if (interestMatch && method === 'POST') {
    const demandId = interestMatch[1];
    const body = await parseBody(req);
    try {
      const result = mockService.submitInterest(demandId, body);
      return sendJson(res, 200, result);
    } catch (e) {
      return sendJson(res, 404, { error: e.message });
    }
  }

  // 5. GET /api/user
  if (pathname === '/api/user' && method === 'GET') {
    return sendJson(res, 200, {
      name: "Automation User",
      email: "engineer@company.com",
      userType: "BENCH_USER"
    });
  }

  // --- AUTOMATION ENGINE CONTROLS ---

  // GET /api/automation/status
  if (pathname === '/api/automation/status' && method === 'GET') {
    return sendJson(res, 200, {
      isRunning: engine.isRunning,
      stats: engine.stats,
      target: engine.target,
      intervalMs: engine.intervalMs,
      logs: engine.logs.slice(0, 50)
    });
  }

  // POST /api/automation/start
  if (pathname === '/api/automation/start' && method === 'POST') {
    const body = await parseBody(req);
    if (body.target && (body.target === 'mock' || body.target === 'prod')) {
      engine.target = body.target;
      engine.baseUrl = CONFIG.environments[body.target].baseUrl;
      engine.authToken = body.authToken || CONFIG.environments[body.target].authToken;
    }
    engine.start();
    return sendJson(res, 200, { status: 'started', isRunning: engine.isRunning });
  }

  // POST /api/automation/stop
  if (pathname === '/api/automation/stop' && method === 'POST') {
    engine.stop();
    return sendJson(res, 200, { status: 'stopped', isRunning: engine.isRunning });
  }

  // POST /api/automation/tick
  if (pathname === '/api/automation/tick' && method === 'POST') {
    await engine.tick();
    return sendJson(res, 200, { status: 'ticked', stats: engine.stats });
  }

  // POST /api/mock/reset
  if (pathname === '/api/mock/reset' && method === 'POST') {
    mockService.reset();
    engine.appliedDemands.clear();
    engine.stats.totalApplied = 0;
    engine.stats.totalSkippedPythonOnly = 0;
    engine.stats.totalSkippedAlreadyApplied = 0;
    engine.log('INFO', 'Mock database reset to initial state.');
    return sendJson(res, 200, { status: 'reset' });
  }

  // POST /api/mock/add
  if (pathname === '/api/mock/add' && method === 'POST') {
    const body = await parseBody(req);
    const newDemand = mockService.addTestDemand(body);
    engine.log('INFO', `Test Demand [${newDemand.demandId}] injected: ${newDemand.genus} (Skills: ${newDemand.additionalSkills.join(', ')})`);
    return sendJson(res, 200, { status: 'added', demand: newDemand });
  }

  // --- STATIC ASSETS FOR THE UI CLONE ---
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
  
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Opportunistic Placement Clone & Automation Server`);
  console.log(`   Running at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
  
  // Start engine now that server is up
  engine.start();
});
