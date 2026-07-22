import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSocket } from '../SocketContext';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';

const STATUS_META = {
  connecting: { cls: 'status--pending', label: 'Connecting…' },
  initializing: { cls: 'status--pending', label: 'Starting WhatsApp…' },
  scan_qr: { cls: 'status--pending', label: 'Scan QR' },
  connected: { cls: 'status--connected', label: 'Connected' },
  disconnected: { cls: '', label: 'Disconnected' },
  error: { cls: '', label: 'Error' },
};

function ConnectionPanel() {
  const socket = useSocket();
  const { token } = useAuth();
  const [status, setStatus] = useState('connecting');
  const [qrCode, setQrCode] = useState(null);
  const [error, setError] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  // Preload the whitelist this user saved earlier.
  useEffect(() => {
    if (!token) return;
    apiFetch('/api/me', { token })
      .then((me) => setSelectedGroups(me.selectedGroups || []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!socket) return;

    setStatus(socket.connected ? 'initializing' : 'connecting');

    const onConnect = () => setStatus((s) => (s === 'connecting' ? 'initializing' : s));
    const onDisconnect = () => setStatus('connecting');
    const onConnectError = () => setStatus('connecting');
    const handleQR = (qr) => {
      setQrCode(qr);
      setError(null);
      setStatus('scan_qr');
    };
    const handleStatus = (newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        setQrCode(null);
        setError(null);
      }
    };
    const handleGroups = (fetchedGroups) => setGroups(fetchedGroups);
    const handleError = (msg) => {
      setError(msg || 'Something went wrong.');
      setStatus('error');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('whatsapp_qr', handleQR);
    socket.on('whatsapp_status', handleStatus);
    socket.on('whatsapp_groups', handleGroups);
    socket.on('whatsapp_error', handleError);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('whatsapp_qr', handleQR);
      socket.off('whatsapp_status', handleStatus);
      socket.off('whatsapp_groups', handleGroups);
      socket.off('whatsapp_error', handleError);
    };
  }, [socket]);

  const handleRetry = () => {
    if (!socket) return;
    setError(null);
    setQrCode(null);
    setStatus('initializing');
    socket.emit('restart_whatsapp');
  };

  const handleToggleGroup = (groupId) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSavePreferences = async () => {
    setSaveState('saving');
    try {
      await apiFetch('/api/groups', { token, method: 'POST', body: { selectedGroups } });
      setSaveState('saved');
    } catch (err) {
      console.error('Error saving preferences', err);
      setSaveState('error');
    }
    setTimeout(() => setSaveState('idle'), 2600);
  };

  const meta = STATUS_META[status] || STATUS_META.disconnected;
  const canRetry = socket && ['initializing', 'scan_qr', 'disconnected', 'error'].includes(status);

  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg">WhatsApp Connection</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Link your account to start capturing drives.
          </p>
        </div>
        <span className={`status ${meta.cls}`} style={status === 'error' ? { color: 'var(--danger)' } : undefined}>
          <span className="dot" style={status === 'error' ? { background: 'var(--danger)' } : undefined} />
          {meta.label}
        </span>
      </div>

      {/* QR reveal */}
      {status === 'scan_qr' && qrCode && (
        <div className="mt-6 flex flex-col items-center text-center animate-scale">
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Open WhatsApp → <strong style={{ color: 'var(--text)' }}>Linked Devices</strong> → Link a device, then scan:
          </p>
          <div className="p-4 bg-white rounded-2xl" style={{ boxShadow: '0 12px 40px -12px rgba(0,0,0,0.7)' }}>
            <QRCodeSVG value={qrCode} size={224} />
          </div>
        </div>
      )}

      {/* Connecting / initializing */}
      {(status === 'connecting' || status === 'initializing') && (
        <div
          className="mt-6 flex items-center gap-3 text-sm px-4 py-3 rounded-[10px]"
          style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />
          {status === 'connecting'
            ? 'Connecting to the server…'
            : 'Starting WhatsApp — the QR can take up to a minute the first time.'}
        </div>
      )}

      {/* Error / disconnected */}
      {(status === 'error' || status === 'disconnected') && (
        <div
          className="mt-6 text-sm px-4 py-3 rounded-[10px]"
          style={{
            color: status === 'error' ? 'var(--danger)' : 'var(--text-muted)',
            background: status === 'error' ? 'rgba(251,113,133,0.1)' : 'var(--surface-2)',
            border: `1px solid ${status === 'error' ? 'rgba(251,113,133,0.28)' : 'var(--border)'}`,
          }}
        >
          {status === 'error' ? error : 'WhatsApp is not linked yet.'}
        </div>
      )}

      {/* Retry — available whenever it's not fully connected */}
      {canRetry && (
        <button onClick={handleRetry} className="btn mt-4">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M12 7a5 5 0 1 1-1.46-3.54M12 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {status === 'scan_qr' ? 'Regenerate QR' : 'Retry connection'}
        </button>
      )}

      {/* Group selection */}
      {status === 'connected' && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
              Whitelisted groups to monitor
            </h4>
            {selectedGroups.length > 0 && <span className="badge">{selectedGroups.length} selected</span>}
          </div>

          {groups.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
              Fetching your groups…
            </p>
          ) : (
            <div
              className="max-h-64 overflow-y-auto p-1.5 rounded-[12px]"
              style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}
            >
              {groups.map((group) => (
                <label key={group.id} htmlFor={group.id} className="check-row">
                  <input
                    type="checkbox"
                    id={group.id}
                    checked={selectedGroups.includes(group.id)}
                    onChange={() => handleToggleGroup(group.id)}
                  />
                  <span className="check-box" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6.5L5 9L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="text-sm truncate">{group.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSavePreferences} className="btn btn--primary" disabled={saveState === 'saving'}>
              {saveState === 'saving' ? <span className="spinner" /> : 'Save preferences'}
            </button>
            {saveState === 'saved' && <span className="text-sm animate-in" style={{ color: 'var(--success)' }}>✓ Saved</span>}
            {saveState === 'error' && <span className="text-sm animate-in" style={{ color: 'var(--danger)' }}>Couldn't save — try again</span>}
          </div>
        </div>
      )}
    </section>
  );
}

export default ConnectionPanel;
