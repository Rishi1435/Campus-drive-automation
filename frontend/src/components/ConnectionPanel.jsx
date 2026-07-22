import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSocket } from '../SocketContext';

const STATUS_META = {
  connected: { cls: 'status--connected', label: 'Connected' },
  scan_qr: { cls: 'status--pending', label: 'Scan QR' },
  disconnected: { cls: '', label: 'Disconnected' },
};

function ConnectionPanel({ uid }) {
  const socket = useSocket();
  const [status, setStatus] = useState('disconnected');
  const [qrCode, setQrCode] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    if (!socket || !uid) return;

    const handleQR = (qr) => {
      setQrCode(qr);
      setStatus('scan_qr');
    };
    const handleStatus = (newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') setQrCode(null);
    };
    const handleGroups = (fetchedGroups) => setGroups(fetchedGroups);

    socket.on('whatsapp_qr', handleQR);
    socket.on('whatsapp_status', handleStatus);
    socket.on('whatsapp_groups', handleGroups);

    return () => {
      socket.off('whatsapp_qr', handleQR);
      socket.off('whatsapp_status', handleStatus);
      socket.off('whatsapp_groups', handleGroups);
    };
  }, [socket, uid]);

  const handleToggleGroup = (groupId) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSavePreferences = async () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    setSaveState('saving');
    try {
      const response = await fetch(`${backendUrl}/api/groups/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedGroups }),
      });
      setSaveState(response.ok ? 'saved' : 'error');
    } catch (err) {
      console.error('Error saving preferences', err);
      setSaveState('error');
    }
    setTimeout(() => setSaveState('idle'), 2600);
  };

  const meta = STATUS_META[status] || STATUS_META.disconnected;

  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg">WhatsApp Connection</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Link your account to start capturing drives.
          </p>
        </div>
        <span className={`status ${meta.cls}`}>
          <span className="dot" />
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

      {/* Disconnected hint */}
      {status !== 'connected' && status !== 'scan_qr' && (
        <div
          className="mt-6 flex items-center gap-3 text-sm px-4 py-3 rounded-[10px]"
          style={{ color: 'var(--text-muted)', background: 'var(--surface-2)', border: '1px solid var(--border)' }}
        >
          <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />
          Waiting for the connection… a QR code will appear here.
        </div>
      )}

      {/* Group selection */}
      {status === 'connected' && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
              Groups to monitor
            </h4>
            {selectedGroups.length > 0 && (
              <span className="badge">{selectedGroups.length} selected</span>
            )}
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
            <button
              onClick={handleSavePreferences}
              className="btn btn--primary"
              disabled={saveState === 'saving'}
            >
              {saveState === 'saving' ? <span className="spinner" /> : 'Save preferences'}
            </button>
            {saveState === 'saved' && (
              <span className="text-sm animate-in" style={{ color: 'var(--success)' }}>✓ Saved</span>
            )}
            {saveState === 'error' && (
              <span className="text-sm animate-in" style={{ color: 'var(--danger)' }}>Couldn't save — try again</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default ConnectionPanel;
