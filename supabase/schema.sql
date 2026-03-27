-- ============================================
-- QMS Air Hive - Supabase Schema
-- Sistema de Control de Calidad para Prolamsa
-- ============================================

-- Tabla de comandos (HMI -> Bridge -> Camara)
CREATE TABLE "QMS_AirHive_commands" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  command TEXT NOT NULL,
  params TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'completed', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- Tabla de inspecciones (Camara -> Bridge -> HMI)
CREATE TABLE "QMS_AirHive_inspections" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  program_number INT,
  model_name TEXT,
  raw_data TEXT,
  measurements JSONB DEFAULT '{}',
  tool_results JSONB DEFAULT '[]',
  image_url TEXT,
  graphics_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de estado del bridge
CREATE TABLE "QMS_AirHive_bridge_status" (
  id INT PRIMARY KEY DEFAULT 1,
  is_connected BOOLEAN DEFAULT FALSE,
  camera_ip TEXT,
  camera_model TEXT,
  camera_mode TEXT,
  firmware_version TEXT,
  last_heartbeat TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insertar row inicial de bridge_status
INSERT INTO "QMS_AirHive_bridge_status" (id, is_connected) VALUES (1, FALSE);

-- Indices para performance
CREATE INDEX idx_qms_commands_status ON "QMS_AirHive_commands" (status) WHERE status = 'pending';
CREATE INDEX idx_qms_inspections_created ON "QMS_AirHive_inspections" (created_at DESC);

-- Habilitar RLS (Row Level Security) - politicas permisivas para este caso
ALTER TABLE "QMS_AirHive_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QMS_AirHive_inspections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QMS_AirHive_bridge_status" ENABLE ROW LEVEL SECURITY;

-- Politicas: permitir lectura y escritura con anon key
CREATE POLICY "Allow all on QMS_AirHive_commands" ON "QMS_AirHive_commands" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on QMS_AirHive_inspections" ON "QMS_AirHive_inspections" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on QMS_AirHive_bridge_status" ON "QMS_AirHive_bridge_status" FOR ALL USING (true) WITH CHECK (true);

-- Tabla de logs de diagnostico (Bridge -> HMI)
CREATE TABLE "QMS_AirHive_logs" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  level TEXT DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'data')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qms_logs_created ON "QMS_AirHive_logs" (created_at DESC);

ALTER TABLE "QMS_AirHive_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on QMS_AirHive_logs" ON "QMS_AirHive_logs" FOR ALL USING (true) WITH CHECK (true);

-- Habilitar Realtime para las tablas
ALTER PUBLICATION supabase_realtime ADD TABLE "QMS_AirHive_commands";
ALTER PUBLICATION supabase_realtime ADD TABLE "QMS_AirHive_inspections";
ALTER PUBLICATION supabase_realtime ADD TABLE "QMS_AirHive_bridge_status";
ALTER PUBLICATION supabase_realtime ADD TABLE "QMS_AirHive_logs";
