import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';
import ConnectionPanel from './ConnectionPanel';
import DataTable from './DataTable';
import SettingsModal from './SettingsModal';

function Dashboard() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [showSettings, setShowSettings] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (token) {
      apiFetch('/api/me', { token })
        .then((me) => setHasApiKey(!!me.hasApiKey))
        .catch(() => {});
    }
  }, [user, token, navigate]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-3" style={{ color: 'var(--text-muted)' }}>
        <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Translucent sticky header */}
      <header
        className="sticky top-0 z-20"
        style={{
          background: 'rgba(10,11,15,0.55)',
          backdropFilter: 'blur(16px) saturate(140%)',
          WebkitBackdropFilter: 'blur(16px) saturate(140%)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="brand">
            <span className="brand__logo">CD</span>
            <span className="brand__name hidden sm:inline">Campus Drive Tracker</span>
          </div>
          <div className="flex items-center gap-3">
            {hasApiKey && (
              <span
                onClick={() => setShowSettings(true)}
                className="badge cursor-pointer hidden sm:inline-flex items-center gap-1.5"
                style={{ color: 'var(--success)', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.1)' }}
                title="API Key configured in Settings"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--success)' }} />
                API Key Saved
              </span>
            )}

            <button onClick={() => setShowSettings(true)} className="btn" style={{ padding: '0.45rem 0.8rem', fontSize: '0.85rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              <span>Settings</span>
            </button>

            <span className="text-sm hidden md:inline" style={{ color: 'var(--text-muted)' }}>
              {user.email}
            </span>

            <button onClick={handleLogout} className="btn btn--danger">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pt-6 pb-6 flex-1 w-full">
        <div className="mb-6 animate-in">
          <h1 className="text-3xl sm:text-4xl" style={{ letterSpacing: '-0.03em' }}>
            Your placement drives
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Connect WhatsApp, pick the groups to watch, and every drive lands here — live.
          </p>
        </div>

        <div className="stagger flex flex-col gap-6">
          <ConnectionPanel />
          <DataTable />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-5 py-4 text-center text-xs border-t w-full" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        Campus Drive Tracker &bull; Real-time placement drive monitoring
      </footer>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onKeyUpdated={(updatedHasKey) => setHasApiKey(updatedHasKey)}
      />
    </div>
  );
}

export default Dashboard;
