import os, glob
from backend.ingest_gpx import ingest_file
from backend.db import load_config

def main():
    _ = load_config()
    gpx_dir = os.path.join(os.path.dirname(__file__), 'gpx')
    files = sorted(glob.glob(os.path.join(gpx_dir, '*.gpx')))
    print(f"Ingest gestartet. Dateien: {len(files)}")
    for f in files:
        ingest_file(f)
    print("Ingest fertig.")

if __name__ == '__main__':
    main()
