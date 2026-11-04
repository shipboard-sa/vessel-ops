"""FastAPI backend for the Vessel Operations Panel (mx-inv-webapp rewrite).

Thin HTTP surface over ``data.py`` (unmodified) plus the schedule
business logic ported out of the Streamlit ``app.py`` into
:mod:`backend.scheduling`. See ``OPEN_ITEMS.md`` / ``CHECKPOINT.md`` and
the ``mx-inv-webapp-rewrite`` project memory for scope and phasing.
"""
