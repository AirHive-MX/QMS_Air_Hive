-- ============================================
-- Migration: measurement_specs table
-- Stores nominal value, USL and LSL per (model, measurement)
-- ============================================

CREATE TABLE "QMS_AirHive_measurement_specs" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  model_name TEXT NOT NULL,
  measurement_name TEXT NOT NULL,
  nominal NUMERIC,
  usl NUMERIC,
  lsl NUMERIC,
  unit TEXT DEFAULT 'mm',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (model_name, measurement_name)
);

CREATE INDEX idx_qms_specs_model ON "QMS_AirHive_measurement_specs" (model_name);

ALTER TABLE "QMS_AirHive_measurement_specs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on QMS_AirHive_measurement_specs"
  ON "QMS_AirHive_measurement_specs"
  FOR ALL USING (true) WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE "QMS_AirHive_measurement_specs";

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_specs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_specs_updated_at
  BEFORE UPDATE ON "QMS_AirHive_measurement_specs"
  FOR EACH ROW EXECUTE FUNCTION update_specs_updated_at();
