from .main import cli

if __name__ == "__main__":
    # Allow `python -m ct_secretsd`
    try:
        import typer
        typer.run(cli)
    except Exception:
        # Fallback if typer.run isn't available in this context
        cli()
