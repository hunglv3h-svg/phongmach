#!/usr/bin/env node
// Sinh bí mật và cấu hình cho backend Medplum cục bộ (môi trường dev/thử nghiệm).
//
//   node infra/medplum/setup.mjs [--force]
//
// Tạo ra (cả hai đã nằm trong .gitignore, KHÔNG commit):
//   .env                         mật khẩu Postgres / Redis, dùng bởi docker-compose.yml
//   config/medplum.config.json   cấu hình server Medplum, gồm khóa ký JWT
//
// Không ghi đè nếu file đã có (đổi mật khẩu sẽ làm hỏng volume Postgres cũ) trừ khi có --force.
// Chỉ cần Node >= 18 và openssl; không cần cài gói nào.

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const force = process.argv.includes('--force');
const envPath = join(dir, '.env');
const configPath = join(dir, 'config', 'medplum.config.json');

if (!force && (existsSync(envPath) || existsSync(configPath))) {
  console.error('Đã có .env hoặc config/medplum.config.json. Dùng --force để tạo lại (sẽ mất quyền vào volume Postgres cũ).');
  process.exit(1);
}

const secret = () => randomBytes(18).toString('base64url');
const pgPassword = secret();
const redisPassword = secret();
const keyPassphrase = secret();

// Khóa ký JWT: RSA 2048 mã hóa bằng passphrase (định dạng PKCS#8 mà Medplum đọc được).
const signingKey = execFileSync(
  'openssl',
  ['genpkey', '-algorithm', 'RSA', '-aes-256-cbc', '-pass', `pass:${keyPassphrase}`, '-pkeyopt', 'rsa_keygen_bits:2048'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
);

const port = Number(process.env.MEDPLUM_PORT ?? 8103);
const baseUrl = `http://localhost:${port}/`;

const config = {
  port,
  baseUrl,
  issuer: baseUrl,
  audience: baseUrl,
  jwksUrl: `${baseUrl}.well-known/jwks.json`,
  authorizeUrl: `${baseUrl}oauth2/authorize`,
  tokenUrl: `${baseUrl}oauth2/token`,
  userInfoUrl: `${baseUrl}oauth2/userinfo`,
  appBaseUrl: 'http://localhost:3000/',
  binaryStorage: 'file:/data/binary/',
  storageBaseUrl: `${baseUrl}storage/`,
  signingKeyId: randomUUID(),
  signingKey,
  signingKeyPassphrase: keyPassphrase,
  supportEmail: 'support@localhost',
  database: { host: 'postgres', port: 5432, dbname: 'medplum', username: 'medplum', password: pgPassword },
  redis: { host: 'redis', port: 6379, password: redisPassword },
  // Lưu AuditEvent cho mọi thao tác đọc/ghi (mặc định Medplum chỉ ghi vào log). Xem kế hoạch, mục T-AUD.
  saveAuditEvents: true,
  // Không cho tự đăng ký project mới: phòng khám được tạo bởi lớp cung cấp (provisioning) của UNIGIS.
  registerEnabled: false,
  logLevel: 'INFO',
};

mkdirSync(join(dir, 'config'), { recursive: true });
writeFileSync(envPath, `POSTGRES_PASSWORD=${pgPassword}\nREDIS_PASSWORD=${redisPassword}\nMEDPLUM_PORT=${port}\n`, { mode: 0o600 });
// Container chạy bằng uid 1000 nên file cấu hình phải đọc được; chứa bí mật nên chỉ dùng cho dev.
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o644 });
chmodSync(envPath, 0o600);

console.log('Đã tạo .env và config/medplum.config.json');
console.log('Tiếp theo:  docker compose -f infra/medplum/docker-compose.yml up -d');
console.log('Kiểm tra:   node infra/medplum/smoke-test.mjs');
