import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nflRouter from "./nfl";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import dataSyncRouter from "./data-sync";
import featuresRouter from "./features";
import modelsRouter from "./models";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nflRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(dataSyncRouter);
router.use(featuresRouter);
router.use(modelsRouter);

export default router;
