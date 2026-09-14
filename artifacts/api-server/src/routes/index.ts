import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nflRouter from "./nfl";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import dataSyncRouter from "./data-sync";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nflRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(dataSyncRouter);

export default router;
