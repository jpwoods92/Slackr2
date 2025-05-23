import { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { io, Socket } from 'socket.io-client';

import { RootState } from '@/store';
import { Message } from '@/types';

interface RoomSocketProps {
  roomId?: string;
}

interface CreateMessageDto {
  content: string;
  roomId: string;
}

export const useRoomSocket = ({ roomId }: RoomSocketProps = {}) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [currentRoom, setCurrentRoom] = useState<string | undefined>(roomId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomMembers, setRoomMembers] = useState<string[]>([]);

  // Get authentication state from Redux
  const { token, user } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    // Don't connect if not authenticated
    if (!token || !user) return;

    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3000';
    const newSocket = io(backendUrl, {
      auth: {
        token,
      },
    });

    setSocket(newSocket);

    // If roomId is provided initially, join the room
    if (roomId) {
      newSocket.emit('joinRoom', roomId);
      setCurrentRoom(roomId);
    }

    newSocket.on('connect_error', (err) => {
      throw new Error(`Connection error: ${err.message}`);
    });

    newSocket.on('roomMembers', (roomMembers: string[]) => {
      setRoomMembers(roomMembers);
    });

    newSocket.on('messageHistory', (messages: Message[]) => {
      setMessages(messages);
    });

    newSocket.on('newMessage', (message: Message) => {
      setMessages((prev) => [...prev, message]);
    });

    newSocket.on('messageUpdated', (message: Message) => {
      setMessages((prev) => prev.map((msg) => (msg.id === message.id ? message : msg)));
    });

    newSocket.on('messageDeleted', (messageId: string) => {
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
    });

    return () => {
      // Leave current room if any before disconnecting
      if (currentRoom) {
        newSocket.emit('leaveRoom', currentRoom);
      }
      newSocket.disconnect();
    };
  }, [token, user]);

  useEffect(() => {
    if (!socket || !user) return;

    // If the room changed
    if (roomId !== currentRoom) {
      // Leave current room if any
      if (currentRoom) {
        socket.emit('leaveRoom', currentRoom);
      }

      // Join new room if provided
      if (roomId) {
        socket.emit('joinRoom', roomId);
      }

      setCurrentRoom(roomId);
    }
  }, [socket, roomId, currentRoom, user]);

  const joinRoom = useCallback(
    (newRoomId: string) => {
      if (socket && user && newRoomId !== currentRoom) {
        if (currentRoom) {
          socket.emit('leaveRoom', currentRoom);
        }
        socket.emit('joinRoom', newRoomId);
        setCurrentRoom(newRoomId);
      }
    },
    [socket, currentRoom, user]
  );

  const leaveRoom = useCallback(() => {
    if (socket && currentRoom) {
      socket.emit('leaveRoom', currentRoom);
      setCurrentRoom(undefined);
    }
  }, [socket, currentRoom]);

  const sendMessage = useCallback(
    (content: string) => {
      if (socket && currentRoom && content.trim()) {
        const messageData: CreateMessageDto = {
          content,
          roomId: currentRoom,
        };

        socket.emit('sendMessage', messageData);
      }
    },
    [socket, currentRoom]
  );

  const listenForEvent = useCallback(
    <T>(event: string, callback: (data: T) => void) => {
      if (socket) {
        socket.on(event, callback);
        return () => {
          socket.off(event, callback);
        };
      }
      return () => {};
    },
    [socket]
  );

  // Specific event listeners based on the gateway implementation
  const onNewMessage = useCallback(
    (callback: (message: Message) => void) => {
      return listenForEvent<Message>('newMessage', callback);
    },
    [listenForEvent]
  );

  const onUserJoined = useCallback(
    (callback: (data: { userId: string; roomId: string }) => void) => {
      return listenForEvent('userJoined', callback);
    },
    [listenForEvent]
  );

  const onUserLeft = useCallback(
    (callback: (data: { userId: string; roomId: string }) => void) => {
      return listenForEvent('userLeft', callback);
    },
    [listenForEvent]
  );

  return {
    socket,
    currentRoom,
    joinRoom,
    leaveRoom,
    sendMessage,
    messages,
    roomMembers,
    listenForEvent,
    onNewMessage,
    onUserJoined,
    onUserLeft,
    isConnected: !!socket,
    isAuthenticated: !!token && !!user,
  };
};
