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
      env: {
        AKSHARE_HTTP_PORT: '8848',
        AKSHARE_MCP_TTL_QUOTE: '15',
        AKSHARE_MCP_TTL_RANK: '60',
        AKSHARE_MCP_TTL_SPOT: '300',
        AKSHARE_MCP_SCREENING_STALE_SECONDS: '900',
        AKSHARE_MCP_MARKET_PREWARM_INTERVAL_SECONDS: '240',
        AKSHARE_MCP_SINA_RANK_TIMEOUT: '15',
        AKSHARE_MCP_STOCK_NEWS_TIMEOUT: '8',
        AKSHARE_MCP_HTTP_TIMEOUT: '15',
        AKSHARE_MCP_TTL_INDEX: '60',
        AKSHARE_MCP_MAX_ROWS: '50',
      },
      watch: false,
      time: true,
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 20,
      restart_delay: 3000,
      exp_backoff_restart_delay: 3000,
      kill_timeout: 10000,
      max_memory_restart: '600M',
      out_file: '/var/log/holaday/akshare-mcp-http.out.log',
      error_file: '/var/log/holaday/akshare-mcp-http.err.log',
      merge_logs: true,
    },
  ],
};
