/**
 * PM2 Ecosystem für Routy
 * Start/Restart als Service und optionale On-Demand Tasks.
 * Pfade sind auf deinen Host angepasst (/home/emil007/routy).
 */
module.exports = {
  apps: [
    {
      name: "routy-bot",
      cwd: "/home/emil007/routy",
      script: ".venv/bin/python",
      args: "-m bot.bot",
      interpreter: "none",           // script ist bereits ein ausführbares Python
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 20,
      min_uptime: "30s",
      restart_delay: 2000,
      env: {
        ROUTY_CONFIG: "config.ini"   // falls du eine alternative config nutzen willst, hier anpassen
      },
      out_file: "logs/routy.out.log",
      error_file: "logs/routy.err.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    },
    // Optional: On-Demand Ingest (einmalig starten, kein Autorestart)
    {
      name: "routy-ingest",
      cwd: "/home/emil007/routy",
      script: ".venv/bin/python",
      args: "bootstrap.py",
      interpreter: "none",
      autorestart: false
    },
    // Optional: On-Demand Precalc (einmalig starten, kein Autorestart)
    {
      name: "routy-precalc",
      cwd: "/home/emil007/routy",
      script: ".venv/bin/python",
      args: "-m backend.compute_routes",
      interpreter: "none",
      autorestart: false
    }
  ]
};
