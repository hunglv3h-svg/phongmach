// Kiểm cách tìm Chromium trên cả hai hệ điều hành bằng hệ tệp giả: máy dev là Windows, còn CI đặt CHROMIUM_PATH
// nên nhánh tự tìm trên Linux không được chạy thật ở đâu khác ngoài sandbox.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromiumPath } from './browser.mjs';

/** Hệ tệp giả: `files` là các tệp chạy, mỗi tệp là mảng [gốc, thư mục bản cài, ...đường dẫn bên trong]. */
function fakeFs(files) {
  const paths = new Set();
  const children = new Map();
  for (const [root, dir, ...rest] of files) {
    paths.add(root).add(join(root, dir, ...rest));
    children.set(root, [...(children.get(root) ?? []), dir]);
  }
  return { exists: (p) => paths.has(p), list: (p) => children.get(p) ?? [] };
}

const WIN_HOME = 'C:\\Users\\dev';
const WIN_ROOT = join(WIN_HOME, 'AppData', 'Local', 'ms-playwright');
const win = (files, env = {}) => chromiumPath({ env: { LOCALAPPDATA: join(WIN_HOME, 'AppData', 'Local'), ...env }, platform: 'win32', home: WIN_HOME, ...fakeFs(files) });
const LINUX_HOME = '/home/dev';
const LINUX_CACHE = join(LINUX_HOME, '.cache', 'ms-playwright');
const linux = (files, env = {}) => chromiumPath({ env, platform: 'linux', home: LINUX_HOME, ...fakeFs(files) });

describe('chromiumPath', () => {
  it('CHROMIUM_PATH thắng mọi thứ, không cần tệp tồn tại trong các thư mục của Playwright', () => {
    expect(win([], { CHROMIUM_PATH: 'D:\\x\\chrome.exe' })).toBe('D:\\x\\chrome.exe');
    expect(linux([['/opt/pw-browsers', 'chromium-1200', 'chrome-linux', 'chrome']], { CHROMIUM_PATH: '/usr/bin/google-chrome' })).toBe('/usr/bin/google-chrome');
  });

  it('Windows: lấy chrome-headless-shell trong %LOCALAPPDATA%\\ms-playwright, bản số lớn nhất (so theo số, không theo chữ)', () => {
    const files = [
      [WIN_ROOT, 'chromium_headless_shell-999', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
      [WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
    ];
    expect(win(files)).toBe(join(WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
  });

  it('Windows: không có LOCALAPPDATA thì suy từ thư mục người dùng', () => {
    const files = [[WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe']];
    expect(chromiumPath({ env: {}, platform: 'win32', home: WIN_HOME, ...fakeFs(files) })).toBe(join(WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
  });

  it('Windows: không dùng chrome.exe đầy đủ của Playwright, và báo lỗi có cách cài', () => {
    const files = [[WIN_ROOT, 'chromium-1228', 'chrome-win64', 'chrome.exe']];
    expect(() => win(files)).toThrow(/CHROMIUM_PATH.*chromium-headless-shell/s);
  });

  it('Linux: giữ hành vi cũ, Chromium đầy đủ trong /opt/pw-browsers', () => {
    const files = [
      ['/opt/pw-browsers', 'chromium-1200', 'chrome-linux', 'chrome'],
      ['/opt/pw-browsers', 'chromium_headless_shell-1200', 'chrome-linux', 'headless_shell'],
    ];
    expect(linux(files)).toBe(join('/opt/pw-browsers', 'chromium-1200', 'chrome-linux', 'chrome'));
  });

  it('Linux: chỉ có chrome-headless-shell thì dùng nó, ở thư mục mặc định ~/.cache/ms-playwright, cả bố cục mới lẫn cũ', () => {
    const moi = [[LINUX_CACHE, 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell']];
    expect(linux(moi)).toBe(join(LINUX_CACHE, 'chromium_headless_shell-1243', 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
    const cu = [[LINUX_CACHE, 'chromium_headless_shell-1150', 'chrome-linux', 'headless_shell']];
    expect(linux(cu)).toBe(join(LINUX_CACHE, 'chromium_headless_shell-1150', 'chrome-linux', 'headless_shell'));
  });

  it('Linux: Chromium đầy đủ theo bố cục mới (chrome-linux64)', () => {
    const files = [[LINUX_CACHE, 'chromium-1243', 'chrome-linux64', 'chrome']];
    expect(linux(files)).toBe(join(LINUX_CACHE, 'chromium-1243', 'chrome-linux64', 'chrome'));
  });

  it('PLAYWRIGHT_BROWSERS_PATH thay thư mục mặc định: không nhìn sang thư mục khác', () => {
    const files = [
      ['/opt/pw-browsers', 'chromium-1200', 'chrome-linux', 'chrome'],
      ['/srv/browsers', 'chromium-1100', 'chrome-linux', 'chrome'],
    ];
    expect(linux(files, { PLAYWRIGHT_BROWSERS_PATH: '/srv/browsers' })).toBe(join('/srv/browsers', 'chromium-1100', 'chrome-linux', 'chrome'));
    expect(() => linux([files[0]], { PLAYWRIGHT_BROWSERS_PATH: '/srv/browsers' })).toThrow(/Không tìm thấy Chromium/);
  });

  it('thư mục bản cài có mà thiếu tệp chạy (tải dở) thì lùi về bản cũ hơn', () => {
    const files = [
      [WIN_ROOT, 'chromium_headless_shell-1243', 'INSTALLATION_INCOMPLETE'],
      [WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'],
    ];
    expect(win(files)).toBe(join(WIN_ROOT, 'chromium_headless_shell-1228', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'));
  });

  it('không bao giờ trả về Chrome của hệ thống', () => {
    expect(() => win([['C:\\Program Files\\Google\\Chrome\\Application', 'chrome.exe']])).toThrow(/Không tìm thấy Chromium/);
    expect(() => linux([['/usr/bin', 'google-chrome']])).toThrow(/Không tìm thấy Chromium/);
  });
});
