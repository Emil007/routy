import mysql.connector
import configparser
import os

_cfg = None

def load_config():
    global _cfg
    if _cfg is None:
        cfg = configparser.ConfigParser()
        cfg.read(os.environ.get("ROUTY_CONFIG", "config.ini"))
        _cfg = cfg
    return _cfg

def get_conn():
    cfg = load_config()
    dbs = cfg["db"]
    return mysql.connector.connect(
        host=dbs.get("host", "127.0.0.1"),
        port=dbs.getint("port", 3306),
        user=dbs.get("user"),
        password=dbs.get("password"),
        database=dbs.get("database"),
        autocommit=False,
        consume_results=True,  # ensure pending results are cleared between queries
    )
