import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../../db';
import { signToken, AuthUser } from '../../middleware/auth';
import { loginRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../shared/http';

const router = Router();

router.post(
  '/login',
  loginRateLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      res.status(400).json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu' });
      return;
    }
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
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
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng' });
      return;
    }
    const payload: AuthUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      center_id: user.center_id ?? null,
      teacher_id: user.teacher_id ?? null,
    };
    res.json({ token: signToken(payload), user: payload });
  })
);

export default router;
