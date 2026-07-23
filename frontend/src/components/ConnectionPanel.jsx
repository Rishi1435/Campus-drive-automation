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
  const [groupSearch, setGroupSearch] = useState('');

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

  const handleRefreshGroups = () => socket && socket.emit('refresh_groups');
  const handleDisconnect = () => {
    if (!socket) return;
    setGroups([]);
    socket.emit('logout_whatsapp');
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

  // Filter whitelisted groups currently selected
  const activeWhitelistedGroups = groups.filter((g) => selectedGroups.includes(g.id));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
      {/* LEFT PANEL: WhatsApp Connection Status & Whitelisted Groups */}
      <section className="glass p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-lg">WhatsApp Connection</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                Status & active monitored groups
              </p>
            </div>
            <span className={`status ${meta.cls}`} style={status === 'error' ? { color: 'var(--danger)' } : undefined}>
              <span className="dot" style={status === 'error' ? { background: 'var(--danger)' } : undefined} />
              {meta.label}
            </span>
          </div>

          {/* QR reveal */}
          {status === 'scan_qr' && qrCode && (
            <div className="mt-4 flex flex-col items-center text-center animate-scale">
              <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                Open WhatsApp → <strong>Linked Devices</strong> → Scan:
              </p>
              <div className="p-3 bg-white rounded-xl">
                <QRCodeSVG value={qrCode} size={180} />
              </div>
            </div>
          )}

          {/* Connecting / initializing */}
          {(status === 'connecting' || status === 'initializing') && (
            <div
              className="mt-4 flex items-center gap-3 text-sm px-4 py-3 rounded-[10px]"
              style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            >
              <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />
              {status === 'connecting'
                ? 'Connecting to server…'
                : 'Starting WhatsApp — QR can take a minute.'}
            </div>
          )}

          {/* Error / disconnected */}
          {(status === 'error' || status === 'disconnected') && (
            <div
              className="mt-4 text-sm px-4 py-3 rounded-[10px]"
              style={{
                color: status === 'error' ? 'var(--danger)' : 'var(--text-muted)',
                background: status === 'error' ? 'rgba(251,113,133,0.1)' : 'var(--surface-2)',
                border: `1px solid ${status === 'error' ? 'rgba(251,113,133,0.28)' : 'var(--border)'}`,
              }}
            >
              {status === 'error' ? error : 'WhatsApp is not linked yet.'}
            </div>
          )}

          {/* Controls when connected */}
          {status === 'connected' && (
            <div className="mt-4">
              <div className="flex items-center gap-2 mb-4">
                <button onClick={handleRefreshGroups} className="btn" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M12 7a5 5 0 1 1-1.46-3.54M12 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Refresh
                </button>
                <button onClick={handleDisconnect} className="btn btn--danger" style={{ padding: '0.35rem 0.7rem', fontSize: '0.8rem' }}>
                  Disconnect
                </button>
              </div>

              {/* Active Monitored Groups Summary */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                    Whitelisted Groups
                  </h4>
                  <span className="badge">{selectedGroups.length} Active</span>
                </div>

                {activeWhitelistedGroups.length === 0 ? (
                  <p className="text-xs italic py-2" style={{ color: 'var(--text-faint)' }}>
                    No groups selected yet. Select groups on the right side to start monitoring.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-[10px]" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}>
                    {activeWhitelistedGroups.map((g) => (
                      <span key={g.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--text)', border: '1px solid rgba(99,102,241,0.3)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
                        {g.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {canRetry && (
          <button onClick={handleRetry} className="btn mt-4 self-start">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M12 7a5 5 0 1 1-1.46-3.54M12 2v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {status === 'scan_qr' ? 'Regenerate QR' : 'Retry connection'}
          </button>
        )}
      </section>

      {/* RIGHT PANEL: WhatsApp Group Selection */}
      <section className="glass p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div>
              <h3 className="text-lg">Group Selection</h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                Pick WhatsApp groups to monitor for placement drives
              </p>
            </div>
            {selectedGroups.length > 0 && <span className="badge">{selectedGroups.length} selected</span>}
          </div>

          {status !== 'connected' ? (
            <div className="flex flex-col items-center justify-center text-center py-12 text-xs" style={{ color: 'var(--text-faint)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="mb-2 opacity-50" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Connect WhatsApp on the left to load & select your groups.
            </div>
          ) : (
            <div>
              <p className="text-xs mb-3 px-3 py-2 rounded-[8px]" style={{ color: 'var(--text-muted)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                Don't see a group? Open it in WhatsApp and <strong style={{ color: 'var(--text)' }}>send any message</strong> — it appears here.
              </p>

              {groups.length > 5 && (
                <input
                  type="text"
                  className="input mb-2"
                  placeholder="Search groups…"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                />
              )}

              {groups.length === 0 ? (
                <p className="text-xs py-4 text-center" style={{ color: 'var(--text-faint)' }}>
                  No groups fetched yet — send a message in a group or click Refresh on the left.
                </p>
              ) : (
                <div
                  className="max-h-52 overflow-y-auto p-1.5 rounded-[12px]"
                  style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}
                >
                  {groups
                    .filter((g) => (g.name || '').toLowerCase().includes(groupSearch.toLowerCase()))
                    .sort((a, b) => {
                      const aSel = selectedGroups.includes(a.id);
                      const bSel = selectedGroups.includes(b.id);
                      if (aSel && !bSel) return -1;
                      if (!aSel && bSel) return 1;
                      return (a.name || '').localeCompare(b.name || '');
                    })
                    .map((group) => {
                      const isSelected = selectedGroups.includes(group.id);
                      return (
                        <label
                          key={group.id}
                          htmlFor={group.id}
                          className="check-row"
                          style={isSelected ? { background: 'rgba(99, 102, 241, 0.12)' } : undefined}
                        >
                          <input
                            type="checkbox"
                            id={group.id}
                            checked={isSelected}
                            onChange={() => handleToggleGroup(group.id)}
                          />
                          <span className="check-box" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2.5 6.5L5 9L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                          <span className="text-sm truncate">{group.name}</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>

        {status === 'connected' && (
          <div className="flex items-center gap-3 mt-4">
            <button onClick={handleSavePreferences} className="btn btn--primary" disabled={saveState === 'saving'}>
              {saveState === 'saving' ? <span className="spinner" /> : 'Save preferences'}
            </button>
            {saveState === 'saved' && <span className="text-sm animate-in" style={{ color: 'var(--success)' }}>✓ Saved</span>}
            {saveState === 'error' && <span className="text-sm animate-in" style={{ color: 'var(--danger)' }}>Couldn't save</span>}
          </div>
        )}
      </section>
    </div>
  );
}

export default ConnectionPanel;
