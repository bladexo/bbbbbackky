import { Server, Socket } from 'socket.io';

// Define interfaces for type safety
export interface UserWithStats {
  id: string;
  username: string;
  color: string;
  messageCount: number;
  reactionCount: number;
  points: number;
  lastActive: Date;
  hackAccess?: boolean; // Track if user has hack access for notification
}

export interface RoomMetadata {
  roomId: string;
  roomCode: string;
  name: string;
  theme: string;
  adminId: string;
  settings?: {
    isPrivate?: boolean;
    maxUsers?: number;
    allowGuests?: boolean;
    [key: string]: any;
  };
}

// Shared state
export const activeUsers = new Map<string, UserWithStats>();
export const roomMetadata = new Map<string, RoomMetadata>();
export const userIdentities = new Map<string, string>(); // Maps identity to socket.id

// Socket.IO instance for external imports
let ioInstance: Server;

export function shareSocketInstance(io: Server) {
  ioInstance = io;
}

export function getSocketIO(): Server {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not initialized');
  }
  return ioInstance;
}

// Common utility functions for state management
export function addUser(socketId: string, userData: UserWithStats) {
  activeUsers.set(socketId, userData);
  return userData;
}

export function getUser(socketId: string): UserWithStats | undefined {
  return activeUsers.get(socketId);
}

export function removeUser(socketId: string): boolean {
  return activeUsers.delete(socketId);
}

export function getUserByUsername(username: string): UserWithStats | undefined {
  for (const user of activeUsers.values()) {
    if (user.username.toLowerCase() === username.toLowerCase()) {
      return user;
    }
  }
  return undefined;
}

export function getAllUsers(): UserWithStats[] {
  return Array.from(activeUsers.values());
}

export function getUserCount(): number {
  return activeUsers.size;
}

// Room-related functions
export function addRoom(roomCode: string, roomData: RoomMetadata) {
  roomMetadata.set(roomCode, roomData);
  roomMetadata.set(roomData.roomId, roomData); // Also store by ID
  return roomData;
}

export function getRoom(roomCodeOrId: string): RoomMetadata | undefined {
  return roomMetadata.get(roomCodeOrId);
}

export function removeRoom(roomCodeOrId: string): boolean {
  const room = roomMetadata.get(roomCodeOrId);
  if (room) {
    roomMetadata.delete(roomCodeOrId);
    roomMetadata.delete(room.roomId);
    roomMetadata.delete(room.roomCode);
    return true;
  }
  return false;
} 