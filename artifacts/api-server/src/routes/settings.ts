import { Router, type IRouter } from "express";
import { GetSettingsResponse, UpdateSettingsBody, UpdateSettingsResponse } from "@workspace/api-zod";
import { getAppSettings, updateAppSettings } from "../lib/settings";

const router: IRouter = Router();

function safeSettings(settings: Awaited<ReturnType<typeof getAppSettings>>) {
  return {
    sportsbooks: settings.sportsbooks,
    minimumEdge: settings.minimumEdge,
    minimumConfidence: settings.minimumConfidence,
    unitSize: settings.unitSize,
    kellyEnabled: settings.kellyEnabled,
    oddsApiConfigured: Boolean(process.env.ODDS_API_KEY),
  };
}

router.get("/settings", async (_req, res): Promise<void> => {
  res.json(GetSettingsResponse.parse(safeSettings(await getAppSettings())));
});

router.patch("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const settings = await updateAppSettings(parsed.data);
  res.json(UpdateSettingsResponse.parse(safeSettings(settings)));
});

export default router;