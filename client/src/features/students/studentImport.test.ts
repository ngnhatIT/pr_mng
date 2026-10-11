import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../shared/csv';
import { rowsFromCsv } from './studentImport';

describe('parseCsv', () => {
  it('nháy kép, "" trong ô, xuống dòng trong ô, CRLF, BOM, bỏ dòng trống', () => {
    expect(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n\r\n"line1\nline2",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['line1\nline2', 'z'],
    ]);
  });
  it("tự nhận ';' khi tiêu đề dùng ';'", () => {
    expect(parseCsv('name;phone\nAn;0901')).toEqual([
      ['name', 'phone'],
      ['An', '0901'],
    ]);
  });
});

describe('rowsFromCsv', () => {
  it('nhận tiêu đề file Xuất CSV tiếng Việt, đổi ngày DD/MM/YYYY + nhãn trạng thái', () => {
    const r = rowsFromCsv(
      'Mã HV,Họ tên,Ngày sinh,Trạng thái,Lớp đang học\nHV1,An,5/8/2012,Tạm nghỉ,IELTS\n,Bình,,,'
    );
    expect(r.hasName).toBe(true);
    expect(r.unknownColumns).toEqual(['Lớp đang học']);
    expect(r.rows).toEqual([
      { code: 'HV1', name: 'An', dob: '2012-08-05', status: 'paused' },
      { name: 'Bình' },
    ]);
  });
});
