import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';

const SocketContext = createContext(null);

export const useSocket = () => {
  return useContext(SocketContext);
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      if (socket) {
        socket.close();
        setSocket(null);
      }
      return;
    }

    const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';
    const newSocket = io(backendUrl);

    newSocket.on('connect', () => {
      console.log('Socket Context connected. Registering tenant...');
      newSocket.emit('register_tenant', user.uid);
    });

    setSocket(newSocket);

    return () => newSocket.close();
  }, [user]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
