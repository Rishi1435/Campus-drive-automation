import React, { useEffect, useState } from 'react';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';

function ApiKeyPanel() {
  const { token } = useAuth();
  const [hasKey, setHasKey] = useState(false);
  const [value, setValue] = useState('');
  const [state, setState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    if (!token) return;
    apiFetch('/api/me', { token })
      .then((me) => setHasKey(!!me.hasApiKey))
      .catch(() => {});
  }, [token]);

  const save = async (clear = false) => {
    setState('saving');
    try {
      const res = await apiFetch('/api/apikey', { token, method: 'POST', body: { apiKey: clear ? '' : value } });
      setHasKey(res.hasApiKey);
      setValue('');
      setState('saved');
    } catch {
      setState('error');
    }
    setTimeout(() => setState('idle'), 2600);
  };

  return (
    <section className="glass p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-lg">Your NVIDIA API Key</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
            Use your own key so parsing never hits a shared rate limit.
          </p>
        </div>
        <span
          className="status"
          style={hasKey ? { color: 'var(--success)', borderColor: 'rgba(52,211,153,0.3)', background: 'rgba(52,211,153,0.1)' } : undefined}
        >
          <span className="dot" style={hasKey ? { background: 'var(--success)' } : undefined} />
          {hasKey ? 'Key set' : 'Using shared key'}
        </span>
      </div>

      <p className="text-xs mt-4 mb-3 px-3 py-2 rounded-[8px]" style={{ color: 'var(--text-muted)', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
        Don't have one? Get a free key at{' '}
        <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-2)', fontWeight: 600 }}>
          build.nvidia.com
        </a>{' '}
        → pick a model → “Get API Key”, then paste it below.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="password"
          className="input"
          style={{ maxWidth: '380px' }}
          placeholder={hasKey ? 'Enter a new key to replace the saved one' : 'nvapi-...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer" className="btn">
          Get API key
        </a>
        <button className="btn btn--primary" onClick={() => save(false)} disabled={state === 'saving' || !value.trim()}>
          {state === 'saving' ? <span className="spinner" /> : 'Save key'}
        </button>
        {hasKey && (
          <button className="btn btn--danger" onClick={() => save(true)} disabled={state === 'saving'}>
            Remove
          </button>
        )}
        {state === 'saved' && <span className="text-sm" style={{ color: 'var(--success)' }}>✓ Saved</span>}
        {state === 'error' && <span className="text-sm" style={{ color: 'var(--danger)' }}>Couldn't save</span>}
      </div>
    </section>
  );
}

export default ApiKeyPanel;
