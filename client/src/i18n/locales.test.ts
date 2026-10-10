import { describe, it, expect } from 'vitest';

// Khóa thành quả đợt quét toast cụt (UI loop 77-84):
// 1. mọi namespace vi/en phải có cùng tập key
// 2. toast lỗi không được quay lại dạng cụt kiểu "X thất bại" / "Thất bại"
const viModules = import.meta.glob('./locales/vi/*.json', { eager: true }) as Record<string, any>;
const enModules = import.meta.glob('./locales/en/*.json', { eager: true }) as Record<string, any>;

function jsonOf(mod: any): Record<string, unknown> {
  return mod && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
}

function flatKeys(o: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flatKeys(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

function nsName(path: string): string {
  return path.split('/').pop()!.replace('.json', '');
}

const vi = Object.fromEntries(Object.entries(viModules).map(([p, m]) => [nsName(p), jsonOf(m)]));
const en = Object.fromEntries(Object.entries(enModules).map(([p, m]) => [nsName(p), jsonOf(m)]));

// Toast lỗi cụt: kết thúc bằng "thất bại" mà không nêu bước tiếp theo.
// Pattern chuẩn: "Không … được, vui lòng thử lại".
// Ngoại lệ: nhãn trạng thái (key chứa "status") như "Thất bại" trên badge.
const CURT = /(^|\s)thất bại\s*$/i;

describe('i18n locales', () => {
  it('vi/en có cùng tập namespace', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
  });

  it('vi/en đồng bộ key trong từng namespace', () => {
    for (const ns of Object.keys(vi)) {
      expect(flatKeys(en[ns]).sort(), `namespace ${ns}`).toEqual(flatKeys(vi[ns]).sort());
    }
  });

  it('không còn toast lỗi cụt dạng "X thất bại"', () => {
    const bad: string[] = [];
    const walk = (o: Record<string, unknown>, ns: string, path: string) => {
      for (const [k, v] of Object.entries(o)) {
        const p = path ? `${path}.${k}` : k;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
          walk(v as Record<string, unknown>, ns, p);
        } else if (
          typeof v === 'string' &&
          /toast|fail|error/i.test(p) &&
          !/status/i.test(p) &&
          CURT.test(v)
        ) {
          bad.push(`${ns}.${p} = ${JSON.stringify(v)}`);
        }
      }
    };
    for (const [ns, d] of Object.entries(vi)) walk(d as Record<string, unknown>, ns, '');
    expect(bad).toEqual([]);
  });
});
