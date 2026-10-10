/** Unit test cho E2 (magic bytes upload) — server/src/shared/upload.ts */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { hasAllowedMagic, assertSafeUpload } from './upload';

function buf(...bytes: number[]): Buffer {
  const b = Buffer.alloc(16);
  bytes.forEach((v, i) => (b[i] = v));
  return b;
}

describe('hasAllowedMagic', () => {
  it('PNG/JPEG/PDF đúng header → true', () => {
    assert.equal(hasAllowedMagic(buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), 'png'), true);
    assert.equal(hasAllowedMagic(buf(0xff, 0xd8, 0xff, 0xe0), 'jpg'), true);
    assert.equal(hasAllowedMagic(buf(0xff, 0xd8, 0xff, 0xe0), 'jpeg'), true);
    assert.equal(hasAllowedMagic(buf(0x25, 0x50, 0x44, 0x46, 0x2d), 'pdf'), true);
  });

  it('file text đổi đuôi .pdf → false', () => {
    assert.equal(hasAllowedMagic(buf(0x48, 0x65, 0x6c, 0x6c, 0x6f), 'pdf'), false); // "Hello"
  });

  it('PNG nhưng khai .jpg → false', () => {
    assert.equal(hasAllowedMagic(buf(0x89, 0x50, 0x4e, 0x47), 'jpg'), false);
  });

  it('DOCX (zip) / DOC (ole) / GIF / WEBP / MP4 / MP3', () => {
    assert.equal(hasAllowedMagic(buf(0x50, 0x4b, 0x03, 0x04), 'docx'), true);
    assert.equal(hasAllowedMagic(buf(0xd0, 0xcf, 0x11, 0xe0), 'doc'), true);
    assert.equal(hasAllowedMagic(buf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), 'gif'), true);
    const webp = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50);
    assert.equal(hasAllowedMagic(webp, 'webp'), true);
    const notWebp = buf(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43, 0x44);
    assert.equal(hasAllowedMagic(notWebp, 'webp'), false);
    const mp4 = buf(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70);
    assert.equal(hasAllowedMagic(mp4, 'mp4'), true);
    assert.equal(hasAllowedMagic(buf(0x49, 0x44, 0x33), 'mp3'), true); // ID3
    assert.equal(hasAllowedMagic(buf(0xff, 0xfb), 'mp3'), true); // frame sync
  });

  it('đuôi không hỗ trợ → false', () => {
    assert.equal(hasAllowedMagic(buf(0x89, 0x50, 0x4e, 0x47), 'exe'), false);
  });
});

describe('assertSafeUpload', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-test-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeFile(name: string, head: Buffer, mimetype: string) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, Buffer.concat([head, Buffer.alloc(100)]));
    return { path: p, originalname: name, mimetype };
  }

  it('file hợp lệ → không throw, file còn nguyên', () => {
    const f = makeFile('a.png', buf(0x89, 0x50, 0x4e, 0x47), 'image/png');
    assertSafeUpload(f);
    assert.ok(fs.existsSync(f.path));
  });

  it('file giả mạo → throw 400 + xóa file khỏi đĩa', () => {
    const f = makeFile('evil.pdf', buf(0x4d, 0x5a, 0x90, 0x00), 'application/pdf'); // MZ = exe
    assert.throws(() => assertSafeUpload(f), (e: unknown) => (e as { statusCode?: number }).statusCode === 400);
    assert.ok(!fs.existsSync(f.path));
  });

  it('mimetype không khớp đuôi file → throw 400', () => {
    const f = makeFile('b.png', buf(0x89, 0x50, 0x4e, 0x47), 'application/pdf');
    assert.throws(() => assertSafeUpload(f), (e: unknown) => (e as { statusCode?: number }).statusCode === 400);
    assert.ok(!fs.existsSync(f.path));
  });
});

describe('copyUploadedFileByUrl (P1-3)', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-copy-test-'));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('copy sang tên mới CSPRNG, nội dung giống, file gốc còn nguyên', async () => {
    const { copyUploadedFileByUrl } = await import('./upload');
    fs.writeFileSync(path.join(dir, 'hw_abc123.pdf'), 'NOI-DUNG-GOC');
    const newUrl = copyUploadedFileByUrl('/uploads/hw_abc123.pdf', dir);
    assert.ok(newUrl && newUrl.startsWith('/uploads/hw_') && newUrl.endsWith('.pdf'));
    assert.notEqual(newUrl, '/uploads/hw_abc123.pdf');
    assert.equal(fs.readFileSync(path.join(dir, path.basename(newUrl!)), 'utf8'), 'NOI-DUNG-GOC');
    assert.ok(fs.existsSync(path.join(dir, 'hw_abc123.pdf'))); // file gốc không bị động
  });

  it('URL lạ / file không tồn tại / path traversal → null', async () => {
    const { copyUploadedFileByUrl } = await import('./upload');
    assert.equal(copyUploadedFileByUrl('https://x.com/a.pdf', dir), null);
    assert.equal(copyUploadedFileByUrl('/uploads/khong-co.pdf', dir), null);
    assert.equal(copyUploadedFileByUrl('/uploads/../secret.txt', dir), null);
    assert.equal(copyUploadedFileByUrl(null, dir), null);
  });
});
