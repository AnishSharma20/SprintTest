import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from console_encoding import configure_utf8_stdio
from template_fill_pptx import main
configure_utf8_stdio()
if __name__ == "__main__":
    raise SystemExit(main())
