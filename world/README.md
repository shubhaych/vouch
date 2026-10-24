# world/: Threadline

Threadline is the simulated online fashion marketplace Vouch Desk works for: orders, refunds, carrier events, a ledger, planted errors and an answer key. Everything here is badged **Simulated**.

**Not in the repo yet.** `generate.py`, `detect.py` and `books.py` come from the `threadline_world.zip` attached to the build guide. Unzip it into this folder. Nothing else in the repo depends on them yet.

```bash
cd world
python3 generate.py            # out/      (seed 11, the standard set)
HARD=1 python3 generate.py     # out_hard/ (seed 23, the held-out set)
python3 detect.py              # plain rules vs rules desk against the answer key (HARD=1 for held-out)
pip install -r requirements.txt && python3 books.py   # Beancount export, adjusting entries, bean-check
```

Rules: detectors never read `answer_key.json`; only the scorer does. The standard set was used to tune the desk, so quote the held-out numbers first.
