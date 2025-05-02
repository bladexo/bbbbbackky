import mongoose from 'mongoose';

export interface HackAccess {
  username: string;
  type: 'free' | 'specific' | 'random';
  grantedAt: Date;
  expiresAt: Date | null;
  isActive: boolean;
  isValid(): boolean;
}

interface HackAccessDocument extends mongoose.Document, HackAccess {}

const hackAccessSchema = new mongoose.Schema<HackAccessDocument>({
  username: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['free', 'specific', 'random'] },
  grantedAt: { type: Date, required: true, default: Date.now },
  expiresAt: { type: Date },
  isActive: { type: Boolean, required: true, default: true }
});

// Add index for expiration and active status
hackAccessSchema.index({ expiresAt: 1, isActive: 1 });

// Add method to check if access is valid
hackAccessSchema.methods.isValid = function(): boolean {
  return this.isActive && (this.type === 'free' || new Date() < this.expiresAt);
};

export const HackAccess = mongoose.model<HackAccessDocument>('HackAccess', hackAccessSchema);

export default HackAccess; 