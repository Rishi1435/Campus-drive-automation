import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { useSocket } from '../SocketContext';

function DataTable({ uid }) {
  const socket = useSocket();
  const [drives, setDrives] = useState([]);

  useEffect(() => {
    if (!uid) return;

    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

    const fetchDrives = async () => {
      try {
        const res = await fetch(`${backendUrl}/api/drives/${uid}`);
        if (res.ok) {
          const data = await res.json();
          setDrives(data);
        }
      } catch (err) {
        console.error('Error fetching drives:', err);
      }
    };

    fetchDrives();
  }, [uid]);

  useEffect(() => {
    if (!socket) return;

    const handleNewDrive = (newDrive) => {
      setDrives((prev) => [newDrive, ...prev]);
    };

    socket.on('new_drive', handleNewDrive);

    return () => {
      socket.off('new_drive', handleNewDrive);
    };
  }, [socket]);

  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(drives.map(drive => ({
      Company: drive.company || '-',
      Role: drive.role || '-',
      CTC: drive.ctc || '-',
      Eligibility: drive.eligibility || '-',
      Deadline: drive.deadline || '-',
      Link: drive.applyLink || '-'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Drives");
    XLSX.writeFile(wb, "Campus_Drives.xlsx");
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-semibold">Tracked Drives</h3>
        <button
          onClick={handleExport}
          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
        >
          Export to Excel
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm whitespace-nowrap">
          <thead className="uppercase tracking-wider border-b-2">
            <tr>
              <th className="px-6 py-4 border-b">Company</th>
              <th className="px-6 py-4 border-b">Role</th>
              <th className="px-6 py-4 border-b">CTC</th>
              <th className="px-6 py-4 border-b">Eligibility</th>
              <th className="px-6 py-4 border-b">Deadline</th>
              <th className="px-6 py-4 border-b">Link</th>
            </tr>
          </thead>
          <tbody>
            {drives.length === 0 ? (
              <tr>
                <td colSpan="6" className="px-6 py-4 text-center text-gray-500">No drives tracked yet.</td>
              </tr>
            ) : (
              drives.map((drive) => (
                <tr key={drive.id} className="border-b hover:bg-gray-50">
                  <td className="px-6 py-4">{drive.company || '-'}</td>
                  <td className="px-6 py-4">{drive.role || '-'}</td>
                  <td className="px-6 py-4">{drive.ctc || '-'}</td>
                  <td className="px-6 py-4">{drive.eligibility || '-'}</td>
                  <td className="px-6 py-4">{drive.deadline || '-'}</td>
                  <td className="px-6 py-4">
                    {drive.applyLink ? (
                      <a href={drive.applyLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Apply</a>
                    ) : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataTable;
