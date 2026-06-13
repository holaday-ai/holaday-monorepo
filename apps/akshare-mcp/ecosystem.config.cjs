/**
 * pm2 管理 akshare-mcp 薄 HTTP（uvicorn via `python -m akshare_mcp.http_server`）。
 *
 * ⚠️ 仅监听 127.0.0.1:8848（http_server.py 写死 host=127.0.0.1）—— 它背后是
 * **无鉴权**的数据接口，绝不对公网暴露，只供同机 orchestrator 内网直取。
 * 崩溃自动拉起（autorestart）。
 *
 *   pm2 startOrReload apps/akshare-mcp/ecosystem.config.cjs --update-env
 */
module.exports = {
  apps: [
    {
      name: 'akshare-mcp-http',
      cwd: '/opt/holaday-monorepo/apps/akshare-mcp',
      script: '.venv/bin/python',
      args: '-m akshare_mcp.http_server',
      interpreter: 'none',
      env: { AKSHARE_HTTP_PORT: '8848' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      max_memory_restart: '600M',
    },
  ],
};
