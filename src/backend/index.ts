import { createServer } from './server';
import { loadConfig, loadDotEnv } from './env';

await loadDotEnv();
const config = loadConfig();
for (const w of config.warnings) console.warn(`[contractlens] ${w}`);
const server = createServer(config);
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `[contractlens] ${config.env.HOST}:${config.env.PORT} zaten kullanımda: büyük olasılıkla eski bir sunucu hâlâ çalışıyor.\n` +
        `  Windows PowerShell: Get-NetTCPConnection -LocalPort ${config.env.PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n` +
        `  macOS/Linux: lsof -ti tcp:${config.env.PORT} | xargs kill\n` +
        `  Sonra "npm run backend" komutunu tekrar çalıştırın.`,
    );
    process.exitCode = 1;
    return;
  }
  throw e;
});
server.listen(config.env.PORT, config.env.HOST, () => {
  console.log(
    `[contractlens] backend http://${config.env.HOST}:${config.env.PORT} — mode=${config.provider ? 'llm' : 'demo'} provider=${config.provider?.name ?? 'demo-rules'} model=${config.provider?.model ?? '-'}`,
  );
});
