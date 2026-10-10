/**
 * Test jobTracker (shared/jobTracker.ts): theo dõi job cron đang chạy
 * để graceful shutdown chờ xong (có timeout).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { trackJob, waitForJobs } from './jobTracker';

describe('jobTracker', () => {
  it('trackJob trả về promise gốc và tự gỡ khi job xong', async () => {
    let resolve!: (v: number) => void;
    const p = new Promise<number>((r) => {
      resolve = r;
    });
    assert.equal(trackJob(p), p, 'phải trả về đúng promise gốc');

    let done = false;
    const w = waitForJobs(5000).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(done, false, 'job chưa xong thì waitForJobs phải chờ');

    resolve(1);
    await w;
    assert.equal(done, true, 'job xong thì waitForJobs resolve');

    // Set đã trống: waitForJobs sau đó phải resolve ngay
    const t0 = Date.now();
    await waitForJobs(5000);
    assert.ok(Date.now() - t0 < 1000, 'không còn job thì không chờ');
  });

  it('job reject vẫn được gỡ và waitForJobs không throw', async () => {
    const p = Promise.reject(new Error('boom'));
    trackJob(p);
    await p.catch(() => undefined); // đánh dấu đã xử lý để tránh unhandledRejection
    await waitForJobs(5000); // allSettled: không throw
    const t0 = Date.now();
    await waitForJobs(5000);
    assert.ok(Date.now() - t0 < 1000, 'job lỗi đã được gỡ khỏi set');
  });

  it('waitForJobs hết timeout khi job treo quá lâu', async () => {
    let resolve!: () => void;
    const hanging = new Promise<void>((r) => {
      resolve = r;
    });
    trackJob(hanging);
    const t0 = Date.now();
    await waitForJobs(200);
    const dt = Date.now() - t0;
    assert.ok(dt >= 150 && dt < 3000, `timeout phải kích hoạt (~200ms), thực tế ${dt}ms`);
    resolve(); // dọn: gỡ job treo khỏi set để không ảnh hưởng test khác
    await waitForJobs(1000);
  });
});
