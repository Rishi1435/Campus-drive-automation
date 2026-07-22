const http = require('http');

const port = 3000;

function postGroups() {
  const data = JSON.stringify({
    selectedGroups: ['group1', 'group2']
  });

  const options = {
    hostname: 'localhost',
    port: port,
    path: '/api/groups/tenant123',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };

  const req = http.request(options, res => {
    let responseBody = '';
    res.on('data', d => {
      responseBody += d;
    });
    res.on('end', () => {
      console.log('POST /api/groups/tenant123 Status:', res.statusCode);
      console.log('Body:', responseBody);
      getDrives();
    });
  });

  req.on('error', error => {
    console.error(error);
  });

  req.write(data);
  req.end();
}

function getDrives() {
  http.get(`http://localhost:${port}/api/drives/tenant123`, res => {
    let data = '';
    res.on('data', chunk => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('GET /api/drives/tenant123 Status:', res.statusCode);
      console.log('Body:', data);
      process.exit(0);
    });
  }).on('error', err => {
    console.log('Error: ' + err.message);
  });
}

postGroups();
