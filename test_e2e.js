const { io } = require('socket.io-client');
const http = require('http');
const { spawn } = require('child_process');

console.log('Starting backend server...');
const serverProcess = spawn('node', ['backend/server.js']);

serverProcess.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('Server listening on port 3000')) {
    runTest();
  }
});

function runTest() {
  console.log('Backend started. Connecting socket client...');
  const tenantId = 'testTenantE2E';
  const socket = io('http://localhost:3000');

  socket.on('connect', () => {
    console.log('Socket connected. Registering tenant...');
    socket.emit('register_tenant', tenantId);
  });

  socket.on('whatsapp_qr', () => {
    console.log('Received whatsapp_qr event as expected. Now checking APIs...');

    // Test POST Groups API
    const postData = JSON.stringify({ selectedGroups: ['group1', 'group2'] });
    const postOptions = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/groups/${tenantId}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
      }
    };

    const postReq = http.request(postOptions, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        console.log(`POST groups status: ${res.statusCode}`);
        if (res.statusCode === 200) {
          testDrivesApi(tenantId);
        } else {
          finish(false, 'POST groups failed');
        }
      });
    });
    postReq.write(postData);
    postReq.end();
  });

  function testDrivesApi(tenantId) {
    http.get(`http://localhost:3000/api/drives/${tenantId}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
         console.log(`GET drives status: ${res.statusCode}`);
         if (res.statusCode === 200) {
           finish(true);
         } else {
           finish(false, 'GET drives failed');
         }
      });
    });
  }

  function finish(success, errorMsg) {
     if (success) {
       console.log('End-to-End integration test PASSED.');
     } else {
       console.error('End-to-End integration test FAILED:', errorMsg);
     }
     socket.close();
     serverProcess.kill();
     process.exit(success ? 0 : 1);
  }
}
