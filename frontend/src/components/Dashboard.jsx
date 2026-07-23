import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import ConnectionPanel from './ConnectionPanel';
import ApiKeyPanel from './ApiKeyPanel';
import DataTable from './DataTable';

function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

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
    <div>
      {/* Translucent sticky header — content scrolls underneath it. */}
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
            <span className="text-sm hidden sm:inline" style={{ color: 'var(--text-muted)' }}>
              {user.email}
            </span>
            <button onClick={handleLogout} className="btn btn--danger">
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 pt-6 pb-8">
        <div className="mb-6 animate-in">
          <h1 className="text-3xl sm:text-4xl" style={{ letterSpacing: '-0.03em' }}>
            Your placement drives
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Connect WhatsApp, pick the groups to watch, and every drive lands here — live.
          </p>
        </div>

        <div className="stagger flex flex-col gap-6">
          {/* Connection (incl. the group list) and the API key sit side by side on
              medium and wider screens. items-start keeps each panel its own height. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <ConnectionPanel />
            <ApiKeyPanel />
          </div>
          <DataTable />
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-5 py-6 text-center text-xs border-t mt-4 mb-4" style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}>
        Campus Drive Tracker &bull; Real-time placement drive monitoring
      </footer>
    </div>
  );
}

export default Dashboard;
