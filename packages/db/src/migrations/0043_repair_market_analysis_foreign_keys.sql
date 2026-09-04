DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_market_analysis_current_snapshot_id') THEN
    ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_snapshot_id" FOREIGN KEY ("current_snapshot_id") REFERENCES "public"."market_snapshot"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_market_analysis_current_chart_render_id') THEN
    ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_chart_render_id" FOREIGN KEY ("current_chart_render_id") REFERENCES "public"."market_chart_render"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_market_analysis_current_generation_id') THEN
    ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_generation_id" FOREIGN KEY ("current_generation_id") REFERENCES "public"."market_generation"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_market_analysis_handoff_market_snapshot_id') THEN
    ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_market_snapshot_id" FOREIGN KEY ("market_snapshot_id") REFERENCES "public"."market_snapshot"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END;
$$;
