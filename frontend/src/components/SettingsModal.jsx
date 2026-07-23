import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';

function SettingsModal({ isOpen, onClose, onKeyUpdated }) {
  const { token } = useAuth();
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    if (!token || !isOpen) return;
    apiFetch('/api/me', { token })
      .then((me) => setHasKey(!!me.hasApiKey))
      .catch(() => {});
  }, [token, isOpen]);

  if (!isOpen) return null;

  const save = async (clear = false) => {
    setState('saving');
    try {
      const res = await apiFetch('/api/apikey', { token, method: 'POST', body: { apiKey: clear ? '' : value } });
      setHasKey(res.hasApiKey);
      setValue('');
      setState('saved');
      if (onKeyUpdated) onKeyUpdated(res.hasApiKey);
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-md glass p-6 animate-scale relative" style={{ background: '#12141d', border: '1px solid var(--border-strong)' }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <h3 className="text-lg font-semibold">Settings</h3>
          </div>
          <button onClick={onClose} className="btn" style={{ padding: '0.2rem 0.5rem', fontSize: '1rem', lineHeight: 1 }}>&times;</button>
        </div>

        <div className="border-t border-b py-4 my-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h4 className="text-sm font-semibold">NVIDIA API Key</h4>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Use your own key to bypass shared rate limits.
              </p>
            </div>
            <span
              className="status"
              style={hasKey ? { color: 'var(--success)', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.1)' } : undefined}
            >
              <span className="dot" style={hasKey ? { background: 'var(--success)' } : undefined} />
              {hasKey ? 'Custom Key' : 'Shared Key'}
            </span>
          </div>

          <p className="text-xs mb-3 px-3 py-2 rounded-[8px]" style={{ color: 'var(--text-muted)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
            Get a free key at{' '}
            <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-2)', fontWeight: 600 }}>
              build.nvidia.com
            </a>{' '}
            → pick a model → "Get API Key".
          </p>

          <input
            type="password"
            className="input mb-3"
            placeholder={hasKey ? 'Enter new key to replace' : 'nvapi-...'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />

          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn--primary" onClick={() => save(false)} disabled={state === 'saving' || !value.trim()}>
              {state === 'saving' ? <span className="spinner" /> : 'Save Key'}
            </button>
            {hasKey && (
              <button className="btn btn--danger" onClick={() => save(true)} disabled={state === 'saving'}>
                Remove Key
              </button>
            )}
            {state === 'saved' && <span className="text-sm animate-in" style={{ color: 'var(--success)' }}>✓ Saved</span>}
            {state === 'error' && <span className="text-sm animate-in" style={{ color: 'var(--danger)' }}>Couldn't save</span>}
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onClose} className="btn">Done</button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
