DEV_FLAGS=--dev --text-logs

.PHONY: venv install dev run test lint fmt

venv:
	python3 -m venv .venv

install: venv
	. .venv/bin/activate && pip install -e .[dev]

# Run with auto-generated token on a random port, text logs for readability
dev:
	. .venv/bin/activate && ct-secretsd $(DEV_FLAGS)

# Equivalent using module invocation
run:
	. .venv/bin/activate && python -m ct_secretsd $(DEV_FLAGS)

# Basic test placeholder (pytest to be added later)
test:
	. .venv/bin/activate && pytest -q || true

lint:
	. .venv/bin/activate && black --check ct_secretsd && isort --check-only ct_secretsd && mypy ct_secretsd

fmt:
	. .venv/bin/activate && black ct_secretsd && isort ct_secretsd
