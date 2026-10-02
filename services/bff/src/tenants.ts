import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const ROLES = ['owner', 'doctor', 'assistant'] as const;
export type Role = (typeof ROLES)[number];

const tenantSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  secret: z.string().min(1),
});

const userSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(ROLES),
  tenant: z.string().min(1),
  practitionerId: z.string().optional(),
});

const fileSchema = z.object({ tenants: z.array(tenantSchema).min(1), users: z.array(userSchema).min(1) });

export type Tenant = z.infer<typeof tenantSchema>;
export type DemoUser = z.infer<typeof userSchema>;
export type TenantsFile = z.infer<typeof fileSchema>;

export function parseTenantsFile(json: unknown): TenantsFile {
  const parsed = fileSchema.parse(json);
  const slugs = new Set(parsed.tenants.map((t) => t.slug));
  for (const u of parsed.users) {
    if (!slugs.has(u.tenant)) throw new Error(`Người dùng ${u.id} thuộc phòng khám không tồn tại: ${u.tenant}`);
  }
  return parsed;
}

export function loadTenantsFile(path: string): TenantsFile {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Không đọc được ${path}. Chạy "pnpm seed" để tạo phòng khám demo.`);
  }
  return parseTenantsFile(JSON.parse(text));
}
