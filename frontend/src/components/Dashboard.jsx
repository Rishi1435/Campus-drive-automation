import React, { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useNavigate } from 'react-router-dom';
import ConnectionPanel from './ConnectionPanel';
import DataTable from './DataTable';

function Dashboard() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
      } else {
        navigate('/login');
      }
    });
    return () => unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (err) {
      console.error('Logout error', err);
    }
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
    <div className="min-h-screen">
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

      <main className="max-w-6xl mx-auto px-5 py-8">
        <div className="mb-8 animate-in">
          <h1 className="text-3xl sm:text-4xl" style={{ letterSpacing: '-0.03em' }}>
            Your placement drives
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Connect WhatsApp, pick the groups to watch, and every drive lands here — live.
          </p>
        </div>

        <div className="stagger flex flex-col gap-6">
          <ConnectionPanel uid={user.uid} />
          <DataTable uid={user.uid} />
        </div>
      </main>
    </div>
  );
}

export default Dashboard;
