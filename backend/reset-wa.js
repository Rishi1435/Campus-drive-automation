// Clears a stuck WhatsApp session: kills the session's Chromium (if orphaned)
// and deletes .wwebjs_auth so the next start shows a fresh QR.
// Usage: stop the server, then `npm run reset-wa`.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const authDir = path.join(__dirname, '.wwebjs_auth');

try {
  if (process.platform === 'win32') {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe'\\" | Where-Object { $_.CommandLine -like '*wwebjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
  } else {
    execSync('pkill -f wwebjs 2>/dev/null || true', { stdio: 'ignore', shell: '/bin/sh' });
  }
} catch {
  /* no matching processes — fine */
}

try {
  fs.rmSync(authDir, { recursive: true, force: true });
  console.log('✓ WhatsApp session cleared. Start the server and re-scan the QR.');
} catch (e) {
  console.error(
    'Could not remove .wwebjs_auth:',
    e.message,
    '\nMake sure the server is stopped (Ctrl+C), then run this again.'
  );
  process.exit(1);
}
