import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useSocket } from '../SocketContext';

function ConnectionPanel({ uid }) {
  const socket = useSocket();
  const [status, setStatus] = useState('disconnected');
  const [qrCode, setQrCode] = useState(null);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);

  useEffect(() => {
    if (!socket || !uid) return;

    const handleQR = (qr) => {
      setQrCode(qr);
      setStatus('scan_qr');
    };

    const handleStatus = (newStatus) => {
      setStatus(newStatus);
      if (newStatus === 'connected') {
        setQrCode(null);
      }
    };

    const handleGroups = (fetchedGroups) => {
      setGroups(fetchedGroups);
    };

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
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const handleSavePreferences = async () => {
    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    try {
      const response = await fetch(`${backendUrl}/api/groups/${uid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedGroups })
      });
      if (response.ok) {
        alert('Preferences saved successfully!');
      } else {
        alert('Failed to save preferences.');
      }
    } catch (err) {
      console.error('Error saving preferences', err);
      alert('Error saving preferences.');
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-md mb-8">
      <h3 className="text-xl font-semibold mb-4">WhatsApp Connection</h3>
      <div className="mb-4">
        Status: <span className={`font-bold ${status === 'connected' ? 'text-green-500' : 'text-orange-500'}`}>{status.replace('_', ' ').toUpperCase()}</span>
      </div>

      {status === 'scan_qr' && qrCode && (
        <div className="my-4">
          <p className="mb-2">Scan the QR code below with WhatsApp to link your account:</p>
          <div className="p-4 bg-white inline-block rounded-lg border">
            <QRCodeSVG value={qrCode} size={256} />
          </div>
        </div>
      )}

      {status === 'connected' && (
        <div>
          <h4 className="font-semibold mb-2 mt-4">Select Groups to Monitor:</h4>
          {groups.length === 0 ? (
            <p className="text-gray-500 text-sm">Fetching groups or no groups found...</p>
          ) : (
            <div className="max-h-60 overflow-y-auto border rounded p-2 mb-4 bg-gray-50">
              {groups.map(group => (
                <div key={group.id} className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id={group.id}
                    checked={selectedGroups.includes(group.id)}
                    onChange={() => handleToggleGroup(group.id)}
                    className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300"
                  />
                  <label htmlFor={group.id} className="text-sm">{group.name}</label>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={handleSavePreferences}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition"
          >
            Save Preferences
          </button>
        </div>
      )}
    </div>
  );
}

export default ConnectionPanel;
