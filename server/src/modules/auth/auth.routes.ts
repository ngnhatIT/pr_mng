import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { AuthUser, DUMMY_PASSWORD_HASH } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../shared/http';
import { validate, v } from '../../shared/validate';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken } from './refresh.service';

const router = Router();

function reqMeta(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
      return;
    }
    const user = (await db.prepare('SELECT * FROM users WHERE username = ?').get(username)) as
      | {
          id: number;
          username: string;
          password_hash: string;
          role: string;
          name: string;
          center_id: number | null;
          teacher_id: number | null;
        }
      | undefined;
    const passwordOk = user
      ? bcrypt.compareSync(password, user.password_hash)
      : bcrypt.compareSync(password, DUMMY_PASSWORD_HASH);
    if (!user || !passwordOk) {
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
      return;
    }
    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      kind: 'staff',
      center_id: user.center_id ?? null,
      teacher_id: user.teacher_id ?? null,
    };
    const pair = await issueTokenPair(payload, reqMeta(req));
    res.json({ ...pair, user: payload });
  })
);

/** Đổi refresh token lấy cặp token mới (rotation). */
router.post(
  '/refresh',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = validate(req.body, {
      refresh_token: v.string({ required: true, label: 'Refresh token' }),
    });
    const pair = await rotateRefreshToken(refresh_token, reqMeta(req));
    res.json(pair);
  })
);

/** Đăng xuất: thu hồi refresh token hiện tại. */
router.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { refresh_token } = (req.body ?? {}) as { refresh_token?: string };
    if (refresh_token) await revokeRefreshToken(refresh_token);
    res.json({ ok: true });
  })
);

export default router;
