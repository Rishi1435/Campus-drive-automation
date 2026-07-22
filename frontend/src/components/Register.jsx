import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

function Register() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass p-8 animate-scale">
        <div className="brand mb-7">
          <span className="brand__logo">CD</span>
          <span className="brand__name">Campus Drive Tracker</span>
        </div>

        <h1 className="text-2xl mb-1">Create your account</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Start tracking placement drives in minutes.
        </p>

        {error && (
          <div
            key={error}
            className="shake mb-4 text-sm px-3 py-2.5 rounded-[10px]"
            style={{ color: 'var(--danger)', background: 'rgba(251,113,133,0.1)', border: '1px solid rgba(251,113,133,0.28)' }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleRegister} className="flex flex-col gap-4">
          <div className="field">
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              placeholder="you@college.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn--primary btn--block mt-1" disabled={loading}>
            {loading ? <span className="spinner" /> : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-2)', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
