import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from './api';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const { token } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    if (!token) {
      setSocket((prev) => {
        if (prev) prev.close();
        return null;
      });
      return;
    }

    // The backend authenticates the socket from this token (JWT).
    const newSocket = io(API_URL, { auth: { token } });
    setSocket(newSocket);
    return () => newSocket.close();
  }, [token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
};
