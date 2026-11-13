"""Runs before every test module: no test may reach the real Rohlík cart, whatever imports main first."""

import os

os.environ["ROHLIK_TOKEN"] = ""
