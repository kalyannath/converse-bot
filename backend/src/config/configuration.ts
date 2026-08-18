export interface AppConfig {
  port: number;
  openaiApiKey: string;
  corsOrigins: string[];
  loadTest: boolean;
}

export default (): AppConfig => {
  const openaiApiKey = process.env.OPENAI_API_KEY ?? '';
  const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  return {
    port: Number(process.env.PORT) || 3000,
    openaiApiKey,
    corsOrigins,
    loadTest: process.env.LOAD_TEST === 'true',
  };
};
