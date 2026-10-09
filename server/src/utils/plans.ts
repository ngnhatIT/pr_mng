import { Request } from 'express';
import { db } from '../db';

export interface PlanDef {
  name: string;
  price: number;
  features: string[]; // khóa tính năng: 'zalo_auto' | 'landing' | ...
}

/**
 * Gói cước SaaS:
 * - basic 199k: quản lý cơ bản (không nhắc Zalo tự động, không landing công khai)
 * - standard 399k: + nhắc Zalo tự động, + landing công khai
 * - premium 799k: full tính năng
 */
export const PLANS: Record<string, PlanDef> = {
  basic: { name: 'Cơ bản', price: 199000, features: [] },
  standard: { name: 'Tiêu chuẩn', price: 399000, features: ['zalo_auto', 'landing'] },
  premium: { name: 'Cao cấp', price: 799000, features: ['zalo_auto', 'landing'] },
};

export const ALL_FEATURES = ['zalo_auto', 'landing'];

export interface Center {
  id: number;
  name: string;
  subdomain: string | null;
  phone: string | null;
  address: string | null;
  plan: string;
  plan_expires_at: string | null;
  created_at: string;
}

export async function getCenter(id: number): Promise<Center | undefined> {
  return (await db.prepare('SELECT * FROM centers WHERE id = ?').get(id)) as Center | undefined;
}

export async function listCenters(): Promise<Center[]> {
  return (await db.prepare('SELECT * FROM centers ORDER BY id ASC').all()) as Center[];
}

/** Trung tâm mặc định cho các API công khai (trung tâm đầu tiên) */
export async function getDefaultCenter(): Promise<Center | undefined> {
  return (await db.prepare('SELECT * FROM centers ORDER BY id ASC LIMIT 1').get()) as Center | undefined;
}

/** Gói hiệu lực: hết hạn thì rớt về basic */
export function effectivePlan(center: Center | undefined): string {
  if (!center) return 'basic';
  if (center.plan_expires_at) {
    const today = new Date().toISOString().slice(0, 10);
    if (center.plan_expires_at < today) return 'basic';
  }
  return PLANS[center.plan] ? center.plan : 'basic';
}

/** premium = full tính năng; các gói khác theo danh sách features */
export function hasFeature(center: Center | undefined, key: string): boolean {
  if (!center) return false;
  const plan = effectivePlan(center);
  if (plan === 'premium') return true;
  return (PLANS[plan]?.features || []).includes(key);
}

/**
 * Xác định trung tâm cho API công khai: ưu tiên subdomain từ Host,
 * ngược lại dùng trung tâm mặc định.
 */
export async function resolvePublicCenter(req: Request): Promise<Center | undefined> {
  const host = (req.get('host') || '').split(':')[0].toLowerCase();
  if (host && !['localhost', '127.0.0.1'].includes(host)) {
    const sub = host.split('.')[0];
    if (sub && sub !== 'www') {
      const c = (await db.prepare('SELECT * FROM centers WHERE subdomain = ?').get(sub)) as
        Center | undefined;
      if (c) return c;
    }
  }
  return await getDefaultCenter();
}
