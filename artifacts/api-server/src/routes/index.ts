import { Router, type IRouter } from "express";
import healthRouter from "./health";
import nflRouter from "./nfl";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import dataSyncRouter from "./data-sync";
import featuresRouter from "./features";
import modelsRouter from "./models";
import predictionsRouter from "./predictions";
import consumerRouter from "./consumer";
import consumerTeamAnalyticsRouter from "./consumer-team-analytics";
import consumerGradedChartsRouter from "./consumer-graded-charts";
import confidenceRouter from "./confidence";
import usageAnalyticsRouter from "./usage-analytics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(nflRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(dataSyncRouter);
router.use(featuresRouter);
router.use(modelsRouter);
router.use(predictionsRouter);
router.use(consumerRouter);
router.use(consumerTeamAnalyticsRouter);
router.use(consumerGradedChartsRouter);
router.use(confidenceRouter);
router.use(usageAnalyticsRouter);

export default router;
