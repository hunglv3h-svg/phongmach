import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, loadAuth, saveAuth, setUnauthorizedHandler } from './api';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(undefined);
});

describe('api', () => {
  it('gửi token và mã hóa chuỗi truy vấn', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { intent: 'name', results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await api.search('tok', 'Nguyễn Văn & An');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/patients/search?q=Nguy%E1%BB%85n%20V%C4%83n%20%26%20An');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('chuyển lỗi 4xx thành ApiError có mã và thông điệp tiếng Việt từ máy chủ', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(422, { error: 'invalid-phone', message: 'Số điện thoại không hợp lệ' })));
    const err = await api.createPatient('tok', { clientUuid: 'x', fullName: 'a b' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: 'invalid-phone', message: 'Số điện thoại không hợp lệ' });
  });

  it('gộp các lỗi kiểm tra dạng dữ liệu (400) thành một thông điệp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { error: 'bad-request', issues: [{ path: 'clientUuid', message: 'Invalid UUID' }] })));
    const err = (await api.createPatient('tok', { clientUuid: 'x', fullName: 'a b' }).catch((e: unknown) => e)) as ApiError;
    expect(err.message).toBe('clientUuid: Invalid UUID');
  });

  it('401 khi đã có token thì gọi bộ xử lý đăng xuất', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'unauthenticated' })));
    await expect(api.audit('tok')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('đăng nhập sai (401, chưa có token) không kích hoạt đăng xuất', async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'invalid-login' })));
    await expect(api.login('a', 'x')).rejects.toMatchObject({ code: 'invalid-login' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('mất mạng thành ApiError "network"; hủy yêu cầu thì giữ nguyên AbortError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api.demoUsers()).rejects.toMatchObject({ status: 0, code: 'network' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(api.demoUsers()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('lưu phiên không ném lỗi khi trình duyệt chặn sessionStorage', () => {
    expect(() => saveAuth(undefined)).not.toThrow();
    expect(loadAuth()).toBeUndefined();
  });
});
