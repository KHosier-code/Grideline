import { Router, type IRouter } from "express";
import { getAdminAuthStatus } from "../middlewares/admin";

const router: IRouter = Router();

router.get("/auth/admin-status", (req, res): void => {
  res.json(getAdminAuthStatus(req));
});

export default router;
