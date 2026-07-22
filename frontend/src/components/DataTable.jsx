import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useSocket } from '../SocketContext';
import { useAuth } from '../AuthContext';
import { apiFetch } from '../api';

function DataTable() {
  const socket = useSocket();
  const { token } = useAuth();
  const [drives, setDrives] = useState([]);
  const newIds = useRef(new Set()); // ids that arrived live → get the highlight animation

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        setDrives(await apiFetch('/api/drives', { token }));
      } catch (err) {
        console.error('Error fetching drives:', err);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!socket) return;
    const handleNewDrive = (newDrive) => {
      newIds.current.add(newDrive.id);
      setDrives((prev) => [newDrive, ...prev]);
    };
    socket.on('new_drive', handleNewDrive);
    return () => socket.off('new_drive', handleNewDrive);
  }, [socket]);

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(
      drives.map((d) => ({
        Company: d.company || '-',
        Role: d.role || '-',
        CTC: d.ctc || '-',
        Eligibility: d.eligibility || '-',
        Deadline: d.deadline || '-',
        Link: d.applyLink || '-',
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drives');
    XLSX.writeFile(wb, 'Campus_Drives.xlsx');
  };

  return (
    <section className="glass overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap p-6 pb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg">Tracked Drives</h3>
          <span className="badge">{drives.length}</span>
        </div>
        <button onClick={handleExport} className="btn btn--success" disabled={drives.length === 0}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 1v8m0 0L4.5 6m3 3l3-3M2 12.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Export to Excel
        </button>
      </div>

      {drives.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center px-6 py-16 animate-in">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center mb-4"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: 'var(--text-faint)' }}>
              <path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-sm font-semibold">No drives tracked yet</p>
          <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>
            Connect WhatsApp above — new placement drives will appear here in real time.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Role</th>
                <th>CTC</th>
                <th>Eligibility</th>
                <th>Deadline</th>
                <th>Apply</th>
              </tr>
            </thead>
            <tbody>
              {drives.map((drive) => (
                <tr key={drive.id} className={newIds.current.has(drive.id) ? 'drive-row' : undefined}>
                  <td className="cell-company">{drive.company || '—'}</td>
                  <td>{drive.role || '—'}</td>
                  <td className="cell-ctc">{drive.ctc || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{drive.eligibility || '—'}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{drive.deadline || '—'}</td>
                  <td>
                    {drive.applyLink ? (
                      <a href={drive.applyLink} target="_blank" rel="noopener noreferrer" className="link-pill">
                        Apply
                        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                          <path d="M3 8L8 3M8 3H4M8 3V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-faint)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default DataTable;
