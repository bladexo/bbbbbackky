import mongoose from 'mongoose';

export interface HackAccess {
  username: string;
  type: 'free' | 'specific' | 'random';
  grantedAt: Date;
  usageCount: number;
  maxUsages: number | null;
  isActive: boolean;
  isValid(): boolean;
}

interface HackAccessDocument extends mongoose.Document, HackAccess {}

const hackAccessSchema = new mongoose.Schema<HackAccessDocument>({
  username: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['free', 'specific', 'random'] },
  grantedAt: { type: Date, required: true, default: Date.now },
  usageCount: { type: Number, required: true, default: 0 },
  maxUsages: { type: Number, default: null },
  isActive: { type: Boolean, required: true, default: true }
});

// Add index for active status
hackAccessSchema.index({ isActive: 1 });

// Add method to check if access is valid
hackAccessSchema.methods.isValid = function(): boolean {
  if (!this.isActive) return false;
  if (this.type === 'free') return true;
  return this.maxUsages === null || this.usageCount < this.maxUsages;
};

export const HackAccess = mongoose.model<HackAccessDocument>('HackAccess', hackAccessSchema);

export default HackAccess; 